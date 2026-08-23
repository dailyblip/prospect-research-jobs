import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, normalizeJob, rejectionReason } from '../scripts/sync-jobs.mjs';

const now = new Date('2026-08-23T12:00:00Z');

test('normalizes Apps Script header names', () => {
  const job = normalizeJob({
    Status: 'Active',
    'Job Title': 'Prospect Research Analyst',
    Employer: 'University Foundation',
    Location: 'Remote',
    'Work Mode': 'Remote',
    Source: 'APRA',
    'Apply URL': 'https://jobs.example.edu/123'
  });
  assert.equal(job.title, 'Prospect Research Analyst');
  assert.equal(job.workMode, 'Remote');
  assert.equal(job.applyUrl, 'https://jobs.example.edu/123');
});

test('rejects placeholder records and inactive jobs', () => {
  assert.equal(rejectionReason(normalizeJob({ status: 'Needs Review' }), now), 'not active');
  assert.equal(rejectionReason(normalizeJob({ status: 'Active', title: 'Test Job' }), now), 'missing or placeholder title');
});

test('publishes only complete, recent, unique active jobs', () => {
  const valid = {
    status: 'Active',
    title: 'Senior Prospect Research Analyst',
    employer: 'University Foundation',
    location: 'Remote',
    workMode: 'Remote',
    salaryRange: '$90,000–$110,000',
    postedDate: '2026-08-20',
    dateAdded: '2026-08-21',
    source: 'University Careers',
    sourceUrl: 'https://jobs.example.edu',
    applyUrl: 'https://jobs.example.edu/roles/123',
    summary: 'Supports prospect identification and qualification.',
    tags: 'prospect research, senior, remote'
  };

  const snapshot = buildSnapshot({ jobs: [valid, valid, { ...valid, applyUrl: 'https://example.com/job' }, { ...valid, status: 'Needs Review', applyUrl: 'https://jobs.example.edu/roles/456' }] }, now);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.rejectedCount, 2);
  assert.equal(snapshot.jobs[0].title, valid.title);
});
