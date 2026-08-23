import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(projectRoot, 'data', 'jobs.json');
const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function first(job, ...keys) {
  for (const key of keys) {
    if (job[key] !== undefined && job[key] !== null) return job[key];
  }
  return '';
}

function publicUrl(value) {
  try {
    const parsed = new URL(clean(value));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function parseDate(value) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function placeholder(value) {
  return /^(?:unknown|not listed|review needed|test|example|n\/a|na|none|untitled)(?:\b|$)/i.test(clean(value));
}

export function normalizeJob(raw) {
  const job = {
    status: clean(first(raw, 'status', 'Status')),
    title: clean(first(raw, 'title', 'Job Title')),
    employer: clean(first(raw, 'employer', 'Employer')),
    location: clean(first(raw, 'location', 'Location')) || 'Not listed',
    workMode: clean(first(raw, 'workMode', 'Work Mode')) || 'Unknown',
    salaryRange: clean(first(raw, 'salaryRange', 'Salary Range')) || 'Not listed',
    postedDate: clean(first(raw, 'postedDate', 'Posted Date')),
    dateAdded: clean(first(raw, 'dateAdded', 'Date Added')),
    source: clean(first(raw, 'source', 'Source')),
    sourceUrl: publicUrl(first(raw, 'sourceUrl', 'Source URL')),
    applyUrl: publicUrl(first(raw, 'applyUrl', 'Apply URL')),
    summary: clean(first(raw, 'summary', 'Summary')),
    tags: clean(first(raw, 'tags', 'Tags'))
  };

  if (!['Remote', 'Hybrid', 'Onsite', 'Unknown'].includes(job.workMode)) job.workMode = 'Unknown';
  return job;
}

export function rejectionReason(job, now = new Date()) {
  if (job.status && job.status.toLowerCase() !== 'active') return 'not active';
  if (!job.title || placeholder(job.title)) return 'missing or placeholder title';
  if (!job.employer || placeholder(job.employer)) return 'missing or placeholder employer';
  if (!job.source || placeholder(job.source)) return 'missing or placeholder source';
  if (!job.applyUrl) return 'missing or invalid apply URL';

  const applyHost = new URL(job.applyUrl).hostname;
  if (/(^|\.)example\.(com|org|net)$/i.test(applyHost)) return 'example apply URL';

  const postedDate = parseDate(job.postedDate);
  if (postedDate) {
    const ageDays = Math.floor((now.getTime() - postedDate.getTime()) / DAY_MS);
    if (ageDays > 30) return 'older than 30 days';
  }

  return '';
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = job.applyUrl.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSnapshot(payload, now = new Date()) {
  const sourceJobs = Array.isArray(payload) ? payload : payload?.jobs;
  if (!Array.isArray(sourceJobs)) throw new Error('Feed must contain a jobs array.');

  const normalized = sourceJobs.map(normalizeJob);
  const rejected = normalized.filter(job => rejectionReason(job, now));
  const accepted = dedupe(normalized.filter(job => !rejectionReason(job, now)))
    .sort((a, b) => {
      const addedDifference = (parseDate(b.dateAdded)?.getTime() || 0) - (parseDate(a.dateAdded)?.getTime() || 0);
      if (addedDifference) return addedDifference;
      return (parseDate(b.postedDate)?.getTime() || 0) - (parseDate(a.postedDate)?.getTime() || 0);
    });

  if (sourceJobs.length > 0 && accepted.length === 0) {
    throw new Error('Feed contained rows, but none passed publication validation. Existing data was not changed.');
  }

  return {
    schemaVersion: 1,
    generatedAt: clean(payload?.generatedAt) || now.toISOString(),
    count: accepted.length,
    rejectedCount: rejected.length,
    jobs: accepted
  };
}

async function readCurrentSnapshot() {
  try {
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return { count: 0, jobs: [] };
  }
}

function assertHealthyChange(current, next) {
  const currentCount = Number(current?.count || current?.jobs?.length || 0);
  if (process.env.ALLOW_LARGE_DROP === 'true' || currentCount < 10) return;
  const floor = Math.max(1, Math.floor(currentCount * 0.4));
  if (next.count < floor) {
    throw new Error(`Refusing to replace ${currentCount} jobs with only ${next.count}. Set ALLOW_LARGE_DROP=true after verifying the feed.`);
  }
}

async function main() {
  const feedUrl = clean(process.env.JOBS_FEED_URL);
  if (!feedUrl) throw new Error('JOBS_FEED_URL is required.');

  const response = await fetch(feedUrl, {
    redirect: 'follow',
    headers: { accept: 'application/json', 'user-agent': 'ProspectResearchJobs-Sync/1.0' }
  });

  if (!response.ok) throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) throw new Error(`Feed returned ${contentType || 'an unknown content type'}, not JSON.`);

  const snapshot = buildSnapshot(await response.json());
  const current = await readCurrentSnapshot();
  assertHealthyChange(current, snapshot);

  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
  console.log(`Published ${snapshot.count} jobs; rejected ${snapshot.rejectedCount} rows.`);
}

const isCommandLine = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCommandLine) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
