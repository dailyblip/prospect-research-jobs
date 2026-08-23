import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectFromSources,
  extractJobPosting,
  extractListingsFromHtml,
  mergeJobs,
  pageIsClosed,
  verifyExistingJobs
} from '../scripts/collect-jobs.mjs';

const now = new Date('2026-08-23T12:00:00Z');
const source = { name: 'Test APRA Chapter', url: 'https://chapter.example/jobs' };

function response(body, status = 200, url = '') {
  return { status, url, text: async () => body };
}

test('extracts a linked chapter listing without inventing missing fields', () => {
  const html = `
    <h2><a href="https://employer.example/jobs/123">Director of Prospect Development (Wilmington, NC)</a></h2>
    <h4>University of North Carolina Wilmington</h4>
    <p>Salary Range: $80,000-$95,000</p>
    <p>Closing Date: 9/9/2026</p>
    <p>Wilmington, NC (added 8/20/2026)</p>`;
  const [job] = extractListingsFromHtml(html, source, now);
  assert.equal(job.title, 'Director of Prospect Development (Wilmington, NC)');
  assert.equal(job.employer, 'University of North Carolina Wilmington');
  assert.equal(job.location, 'Wilmington, NC');
  assert.equal(job.salaryRange, '$80,000-$95,000');
  assert.equal(job.postedDate, '2026-08-20');
  assert.equal(job.applyUrl, 'https://employer.example/jobs/123');
});

test('extracts a heading listing whose application link follows the description', () => {
  const html = `
    <h2>Prospect Research Strategist II</h2>
    <h3>University of Idaho, Hybrid</h3>
    <p>The role delivers prospect research and pipeline insights.</p>
    <a href="https://uidaho.example/job/456">Full Description Here.</a>`;
  const [job] = extractListingsFromHtml(html, source, now);
  assert.equal(job.title, 'Prospect Research Strategist II');
  assert.equal(job.employer, 'University of Idaho, Hybrid');
  assert.equal(job.workMode, 'Hybrid');
  assert.equal(job.postedDate, '');
  assert.equal(job.applyUrl, 'https://uidaho.example/job/456');
});

test('reads nested JobPosting JSON-LD and detects closed pages', () => {
  const html = `<script type="application/ld+json">{
    "@context":"https://schema.org",
    "@graph":[{"@type":"JobPosting","title":"Senior Prospect Research Analyst","datePosted":"2026-08-21"}]
  }</script>`;
  assert.equal(extractJobPosting(html).title, 'Senior Prospect Research Analyst');
  assert.equal(pageIsClosed('<main>This position is no longer accepting applications.</main>'), true);
  assert.equal(pageIsClosed('<main>Applications are open.</main>'), false);
});

test('collects and enriches only complete, current jobs', async () => {
  const listing = `
    <h2>Prospect Research Strategist II</h2>
    <h3>University of Idaho</h3>
    <a href="https://uidaho.example/job/456">Full Description Here.</a>`;
  const detail = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title: 'Prospect Research Strategist II',
    datePosted: '2026-08-21',
    validThrough: '2026-09-15',
    hiringOrganization: { name: 'University of Idaho' },
    jobLocationType: 'TELECOMMUTE',
    description: 'Builds prospect profiles and delivers actionable research.'
  })}</script>`;
  const fetchFn = async url => url === source.url ? response(listing, 200, url) : response(detail, 200, url);
  const result = await collectFromSources([source], now, fetchFn);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].postedDate, '2026-08-21');
  assert.equal(result.jobs[0].workMode, 'Remote');
  assert.match(result.jobs[0].summary, /actionable research/);
});

test('fails safely when reachable sources contain no recognizable listings', async () => {
  await assert.rejects(
    collectFromSources([source], now, async url => response('<h1>Jobs</h1>', 200, url)),
    /No listings were recognized/
  );
});

test('merges refreshed jobs, preserves first-seen time, and expires old jobs', () => {
  const current = [
    { applyUrl: 'https://example.edu/job/1', postedDate: '2026-08-10', dateAdded: '2026-08-11T00:00:00Z', title: 'Old title' },
    { applyUrl: 'https://example.edu/job/old', postedDate: '2026-06-01', dateAdded: '2026-06-01T00:00:00Z' }
  ];
  const collected = [{ applyUrl: 'https://example.edu/job/1', postedDate: '2026-08-20', dateAdded: now.toISOString(), title: 'Current title' }];
  const jobs = mergeJobs(current, collected, now);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Current title');
  assert.equal(jobs[0].dateAdded, '2026-08-11T00:00:00Z');
});

test('removes a confirmed closed existing listing but preserves unreachable pages', async () => {
  const jobs = [
    { applyUrl: 'https://example.edu/job/closed', postedDate: '2026-08-20', dateAdded: '2026-08-20T00:00:00Z' },
    { applyUrl: 'https://example.edu/job/unreachable', postedDate: '2026-08-20', dateAdded: '2026-08-20T00:00:00Z' }
  ];
  const fetchFn = async url => {
    if (url.endsWith('/closed')) return response('This job has expired.', 200, url);
    throw new Error('temporary network failure');
  };
  const verified = await verifyExistingJobs(jobs, now, fetchFn);
  assert.deepEqual(verified.map(job => job.applyUrl), ['https://example.edu/job/unreachable']);
});
