import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSnapshot } from './sync-jobs.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(projectRoot, 'data', 'jobs.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_DETAIL_REQUESTS = 60;
const MAX_VERIFY_REQUESTS = 60;

export const DEFAULT_SOURCES = [
  { name: 'Apra Carolinas', url: 'https://apracarolinas.wildapricot.org/Jobs?emulatemode=1' },
  { name: 'Apra Northwest', url: 'https://www.apra-nw.org/Jobs?emulatemode=1' },
  { name: 'Apra Minnesota', url: 'https://apra-mn.org/jobs?emulatemode=1' },
  { name: 'Apra Georgia', url: 'https://apraga.wildapricot.org/Jobs' },
  { name: 'Apra Canada', url: 'https://apracanada.ca/job-postings' },
  { name: 'CARA', url: 'https://caresearchers.org/classifieds.php' },
  { name: 'Apra Career Center', url: 'https://apra.careerwebsite.com/jobs/' },
  { name: 'CASE Career Central', url: 'https://careers.case.org/jobs/function/Prospect/' },
  { name: 'HigherEdJobs — Prospect Research', url: 'https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=prospect%20research' },
  { name: 'HigherEdJobs — Prospect Development', url: 'https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=prospect%20development' },
  { name: 'Philanthropy Jobs — Prospect Research', url: 'https://jobs.philanthropy.com/jobs/prospect-research/' }
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', hellip: '…', ldquo: '“', lsquo: '‘',
    lt: '<', nbsp: ' ', ndash: '–', quot: '"', rdquo: '”', rsquo: '’'
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripHtml(value) {
  return clean(decodeEntities(String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function htmlLines(value) {
  return decodeEntities(String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:address|article|blockquote|div|h[1-6]|li|p|section|table|td|tr|ul)>/gi, '\n')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
}

function publicUrl(value, baseUrl) {
  try {
    const parsed = new URL(decodeEntities(value), baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function parseDate(value, now = new Date()) {
  const text = clean(value).replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, '$1/$2/$3');
  if (!text) return '';

  const relative = text.match(/\b(\d{1,2})\s+days?\s+ago\b/i);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * DAY_MS).toISOString().slice(0, 10);
  if (/\b(?:posted\s*)?today\b/i.test(text)) return now.toISOString().slice(0, 10);

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateFromContext(text, now) {
  const patterns = [
    /\badded\s*:?\s*\(?([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})\)?/i,
    /\badded\s*:?\s*\(?(\d{1,2}[./-]\d{1,2}[./-]\d{4})\)?/i,
    /\b(?:posted|posting date|open date|opening on|date)\s*:?\s*\(?([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})\)?/i,
    /\b(?:posted|posting date|open date|opening on|date)\s*:?\s*\(?(\d{1,2}[./-]\d{1,2}[./-]\d{4})\)?/i,
    /\b(?:posted\s*:?)?\s*(today|\d{1,2}\s+days?\s+ago)\b/i,
    /\b(\d{1,2}[.-]\d{1,2}[.-]\d{4})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = match ? parseDate(match[1], now) : '';
    if (parsed) return parsed;
  }
  return '';
}

function isRelevantTitle(value) {
  const title = clean(value);
  if (title.length < 8 || title.length > 180) return false;
  if (/^(?:jobs?|careers?|view jobs?|search jobs?|job postings?|prospect research)$/i.test(title)) return false;
  return /\b(?:prospect(?:ive)?\s+(?:research|researcher|development|management|intelligence|strategy|analyst)|advancement\s+(?:research|analytics)|donor\s+(?:research|strategy)|relationship\s+intelligence|database\s+analyst\s*[-–—:]?\s*philanthropy)\b/i.test(title);
}

function isRelevantListing(title, context = '') {
  if (isRelevantTitle(title)) return true;
  return /\b(?:research\s+(?:analyst|consultant|manager|specialist)|portfolio\s+management\s+analyst)\b/i.test(title)
    && /\b(?:prospect\s+(?:research|development|management|intelligence)|advancement\s+research)\b/i.test(stripHtml(context));
}

function inferWorkMode(text) {
  const value = clean(text).toLowerCase();
  if (/\bhybrid\b/.test(value)) return 'Hybrid';
  if (!/\b(?:not|isn't|is not)\s+remote\b/.test(value) && /\b(?:remote|work\s+from\s+home|telecommut(?:e|ing)?)\b/.test(value)) return 'Remote';
  if (/\b(?:on[- ]site|in[- ]person)\b/.test(value)) return 'Onsite';
  return 'Unknown';
}

function tagsFor(title, description = '') {
  const text = `${title} ${description}`.toLowerCase();
  const tags = [];
  if (/prospect research|prospect researcher|advancement research/.test(text)) tags.push('Prospect Research');
  if (/prospect development/.test(text)) tags.push('Prospect Development');
  if (/prospect management|portfolio/.test(text)) tags.push('Prospect Management');
  if (/analytics|analysis|business intelligence|predictive/.test(text)) tags.push('Advancement Analytics');
  if (/director|manager|head|chief|vice president/.test(text)) tags.push('Leadership');
  if (/remote/.test(text)) tags.push('Remote');
  return [...new Set(tags)].join(', ');
}

function canonicalEmployer(value) {
  const employer = clean(value);
  if (employer.toLowerCase() === 'jmu careers') return 'James Madison University';
  return employer;
}

function looksLikeEmployer(line, title) {
  const value = clean(line);
  if (!value || value.toLowerCase() === clean(title).toLowerCase()) return false;
  if (value.length < 2 || value.length > 120) return false;
  if (/^(?:apply|apply now|view|view details|learn more|full[- ]?time|part[- ]?time|remote|hybrid|onsite|on-site)$/i.test(value)) return false;
  if (/^(?:salary range|closing date|posted|posting date|open date|location|job type|category|date)\b/i.test(value)) return false;
  if (/\b(?:added|days? ago|until filled)\b/i.test(value) || /^\$/.test(value)) return false;
  return /[a-z]/i.test(value);
}

function sourceContext(html, start, nextStart) {
  const end = Math.min(nextStart ?? html.length, start + 3500);
  return html.slice(start, end);
}

function anchorsInHtml(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html))) !== null) {
    const url = publicUrl(match[3], baseUrl);
    if (url) anchors.push({ text: stripHtml(match[5]), url, index: match.index });
  }
  return anchors;
}

function titleAndEmployer(heading) {
  const parts = clean(heading).split(/\s+[–—-]\s+/);
  if (parts.length < 2) return { title: clean(heading), employer: '' };
  const employer = parts.at(-1);
  const title = parts.slice(0, -1).join(' - ');
  return isRelevantListing(title) && !/\b(?:remote|hybrid|onsite|on-site|[A-Z]{2})\b/.test(employer)
    ? { title, employer }
    : { title: clean(heading), employer: '' };
}

function locationFromLines(lines, title, employer) {
  const candidates = lines
    .flatMap(line => line.split(/\s*\|\s*/))
    .map(clean)
    .filter(line => line && ![title, employer].some(value => clean(value).toLowerCase() === line.toLowerCase()));
  return candidates.find(line => /\b(?:remote|hybrid|on[- ]site|[A-Z][a-z]+,?\s+[A-Z]{2}\b)/i.test(line)
    && !/\b(?:salary|closing date|added|posted|until filled)\b/i.test(line)) || '';
}

function listingFromSegment(titleText, segment, source, now, preferredUrl = '') {
  const split = titleAndEmployer(titleText);
  const lines = htmlLines(segment);
  const metadata = lines.flatMap(line => line.split(/\s*\|\s*/).map(clean)).filter(Boolean);
  const titleIndex = Math.max(0, metadata.findIndex(line => line.toLowerCase() === clean(titleText).toLowerCase()));
  const employer = clean(split.employer || metadata.slice(titleIndex + 1, titleIndex + 10).find(line => looksLikeEmployer(line, split.title)) || '')
    .replace(/,?\s+(?:remote|hybrid|on[- ]site)\s*$/i, '');
  const text = lines.join('\n');
  const salary = text.match(/\bSalary(?: Range)?\s*:\s*([^\n]+)/i)?.[1] || '';
  const closingDate = parseDate(text.match(/\bClosing Date\s*:\s*([^\n]+)/i)?.[1], now);
  const locationWithDate = text.match(/(?:^|\n)([^\n]{2,100}?)\s*\(added\s+[^)]+\)/i)?.[1] || '';
  const labeledLocation = text.match(/\bLocation\s*:\s*([^\n]+)/i)?.[1] || '';
  const location = clean(locationWithDate || labeledLocation || locationFromLines(metadata.slice(titleIndex + 1, titleIndex + 12), split.title, employer)) || 'Not listed';
  const links = anchorsInHtml(segment, source.url);
  const applyUrl = preferredUrl
    || links.find(link => /\b(?:apply|full description|read more|view details|job description)\b/i.test(link.text))?.url
    || links.find(link => link.url !== source.url)?.url
    || '';

  if (!applyUrl) return null;
  return {
    status: 'Active',
    title: split.title,
    employer,
    location,
    workMode: inferWorkMode(`${split.title} ${location} ${text}`),
    salaryRange: /^(?:none|not) listed$/i.test(clean(salary)) ? 'Not listed' : clean(salary) || 'Not listed',
    closingDate,
    postedDate: dateFromContext(text, now),
    dateAdded: now.toISOString(),
    source: source.name,
    sourceUrl: source.url,
    applyUrl,
    summary: '',
    tags: tagsFor(split.title, text)
  };
}

export function extractListingsFromHtml(html, source, now = new Date()) {
  const candidates = [];
  const anchors = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html))) !== null) {
    const title = stripHtml(match[5]);
    if (!isRelevantTitle(title)) continue;
    const applyUrl = publicUrl(match[3], source.url);
    if (!applyUrl || applyUrl === source.url || /^javascript:/i.test(match[3])) continue;
    anchors.push({ title, applyUrl, index: match.index });
  }

  for (const [index, anchor] of anchors.slice(0, 30).entries()) {
    const segment = sourceContext(html, anchor.index, anchors[index + 1]?.index);
    const candidate = listingFromSegment(anchor.title, segment, source, now, anchor.applyUrl);
    if (candidate) candidates.push(candidate);
  }

  const headings = [];
  const headingPattern = /<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = headingPattern.exec(String(html))) !== null) {
    headings.push({ level: Number(match[1]), title: stripHtml(match[2]), raw: match[2], index: match.index, end: headingPattern.lastIndex });
  }
  for (const [index, heading] of headings.entries()) {
    let end = Math.min(html.length, heading.index + 7000);
    for (const next of headings.slice(index + 1)) {
      if (next.level <= heading.level) { end = next.index; break; }
    }
    const segment = html.slice(heading.index, end);
    if (!isRelevantListing(heading.title, segment)) continue;
    const headingUrl = anchorsInHtml(heading.raw, source.url)[0]?.url || '';
    const candidate = listingFromSegment(heading.title, segment, source, now, headingUrl);
    if (candidate) candidates.push(candidate);
  }

  return [...new Map(candidates.map(job => [jobKey(job), job])).values()].slice(0, 40);
}

function jsonLdObjects(html) {
  const objects = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(html))) !== null) {
    try { objects.push(JSON.parse(decodeEntities(match[1]).trim())); } catch { /* malformed third-party JSON-LD */ }
  }
  return objects;
}

function findJobPosting(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => String(type).toLowerCase() === 'jobposting')) return value;
  for (const child of Object.values(value)) {
    const found = findJobPosting(child);
    if (found) return found;
  }
  return null;
}

function addressText(jobPosting) {
  const locations = Array.isArray(jobPosting?.jobLocation) ? jobPosting.jobLocation : [jobPosting?.jobLocation];
  for (const location of locations) {
    const address = location?.address || location;
    if (!address || typeof address !== 'object') continue;
    const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
      .map(clean)
      .filter(part => part && !/^(?:unavailable|unknown|n\/?a|none|null)$/i.test(part));
    if (parts.length) return parts.join(', ');
  }
  return '';
}

function salaryText(jobPosting) {
  const salary = jobPosting?.baseSalary;
  if (!salary) return '';
  if (typeof salary === 'string') return clean(salary);
  const currency = clean(salary.currency || salary.value?.currency);
  const value = salary.value || salary;
  const minimum = Number(value.minValue);
  const maximum = Number(value.maxValue);
  const amount = Number(value.value);
  const unit = clean(value.unitText).toLowerCase();
  const formatter = new Intl.NumberFormat('en-US', { style: currency ? 'currency' : 'decimal', currency: currency || undefined, maximumFractionDigits: 0 });
  let range = '';
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && (minimum > 0 || maximum > 0)) range = `${formatter.format(minimum)} - ${formatter.format(maximum)}`;
  else if (Number.isFinite(amount) && amount > 0) range = formatter.format(amount);
  return range && unit ? `${range} ${unit.toLowerCase()}` : range;
}

export function extractJobPosting(html) {
  for (const object of jsonLdObjects(html)) {
    const posting = findJobPosting(object);
    if (posting) return posting;
  }
  return null;
}

export function pageIsClosed(text) {
  return /\b(?:position (?:has been filled|is no longer available|is no longer accepting applications|deleted)|job (?:is no longer active|has expired)|applications? (?:are|is|have) (?:now )?closed|no longer accepting applications|this job is closed|posting is no longer available)\b/i.test(stripHtml(text));
}

async function fetchPage(url, fetchFn = fetch) {
  const response = await fetchFn(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
      'accept-language': 'en-US,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; ProspectResearchJobs/2.0; +https://prospectresearchjobs.com/)'
    }
  });
  const body = await response.text();
  return { body, status: response.status, url: response.url || url };
}

function expiredByValidThrough(posting, now) {
  const validThrough = parseDate(posting?.validThrough, now);
  return validThrough && new Date(`${validThrough}T23:59:59Z`) < now;
}

async function enrichCandidate(candidate, now, fetchFn) {
  if (candidate.closingDate && new Date(`${candidate.closingDate}T23:59:59Z`) < now) return null;
  let page;
  try { page = await fetchPage(candidate.applyUrl, fetchFn); } catch { return candidate; }
  if ([404, 410].includes(page.status) || pageIsClosed(page.body)) return null;
  if (page.status >= 400) return candidate;

  const posting = extractJobPosting(page.body);
  if (!posting) return candidate;
  if (expiredByValidThrough(posting, now)) return null;

  const description = stripHtml(posting.description || posting.responsibilities || '');
  const postedLocation = addressText(posting);
  const candidateHasSpecificLocation = candidate.location !== 'Not listed' && !/^(?:remote|hybrid|on[- ]site)$/i.test(candidate.location);
  const location = postedLocation && (!candidateHasSpecificLocation || postedLocation.includes(',')) ? postedLocation : candidate.location;
  const modeText = `${posting.jobLocationType || ''} ${posting.description || ''} ${candidate.workMode}`;
  const workMode = inferWorkMode(modeText);
  const postedEmployer = canonicalEmployer(posting.hiringOrganization?.name);
  return {
    ...candidate,
    title: clean(posting.title) || candidate.title,
    employer: postedEmployer && !/\bcareers?$/i.test(postedEmployer) ? postedEmployer : canonicalEmployer(candidate.employer),
    location: workMode === 'Remote' && location === 'Not listed' ? 'Remote' : location,
    workMode: workMode === 'Unknown' ? candidate.workMode : workMode,
    salaryRange: salaryText(posting) || candidate.salaryRange,
    postedDate: parseDate(posting.datePosted, now) || candidate.postedDate,
    summary: description ? `${description.slice(0, 260).trim()}${description.length > 260 ? '…' : ''}` : candidate.summary,
    tags: tagsFor(posting.title || candidate.title, description)
  };
}

function jobKey(job) {
  try {
    const url = new URL(job.applyUrl);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '').toLowerCase()}`;
  } catch {
    return clean(job.applyUrl).toLowerCase();
  }
}

function withinPublicationWindow(job, now) {
  const date = parseDate(job.postedDate || job.dateAdded, now);
  if (!date) return false;
  const age = Math.floor((now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS);
  return age <= 30;
}

export function mergeJobs(currentJobs, collectedJobs, now = new Date()) {
  const current = new Map(
    currentJobs.filter(job => withinPublicationWindow(job, now)).map(job => [jobKey(job), job])
  );
  const merged = new Map(current);

  for (const job of collectedJobs) {
    const key = jobKey(job);
    const previous = current.get(key);
    merged.set(key, {
      ...previous,
      ...job,
      dateAdded: previous?.dateAdded || job.dateAdded || now.toISOString()
    });
  }
  return [...merged.values()];
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function collectFromSources(sources = DEFAULT_SOURCES, now = new Date(), fetchFn = fetch) {
  const status = [];
  const discovered = [];
  const sourceResults = await mapWithConcurrency(sources, 4, async source => {
    try {
      const page = await fetchPage(source.url, fetchFn);
      if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
      const jobs = extractListingsFromHtml(page.body, source, now);
      return { jobs, status: { source: source.name, ok: true, found: jobs.length } };
    } catch (error) {
      return { jobs: [], status: { source: source.name, ok: false, found: 0, error: clean(error.message) } };
    }
  });
  for (const result of sourceResults) {
    discovered.push(...result.jobs);
    status.push(result.status);
  }

  if (!status.some(item => item.ok)) throw new Error('Every public job source failed; preserving the existing verified snapshot.');
  if (discovered.length === 0) throw new Error('No listings were recognized on the reachable public sources; preserving the existing verified snapshot.');

  const unique = [...new Map(discovered.map(job => [jobKey(job), job])).values()].slice(0, MAX_DETAIL_REQUESTS);
  const enriched = (await mapWithConcurrency(unique, 5, job => enrichCandidate(job, now, fetchFn)))
    .filter(job => job?.employer && job.postedDate && withinPublicationWindow(job, now));
  return { jobs: enriched, status };
}

export async function verifyExistingJobs(jobs, now = new Date(), fetchFn = fetch) {
  const current = jobs.filter(job => withinPublicationWindow(job, now));
  const checked = await mapWithConcurrency(current.slice(0, MAX_VERIFY_REQUESTS), 5, job => enrichCandidate(job, now, fetchFn));
  return [...checked.filter(Boolean), ...current.slice(MAX_VERIFY_REQUESTS)];
}

async function readCurrentSnapshot() {
  try { return JSON.parse(await readFile(outputPath, 'utf8')); }
  catch { return { count: 0, jobs: [] }; }
}

function assertHealthyChange(currentCount, nextCount) {
  if (process.env.ALLOW_LARGE_DROP === 'true' || currentCount < 10) return;
  const floor = Math.max(1, Math.floor(currentCount * 0.4));
  if (nextCount < floor) throw new Error(`Refusing to replace ${currentCount} jobs with only ${nextCount}; preserving the verified snapshot.`);
}

function sameJobs(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  const now = new Date();
  const current = await readCurrentSnapshot();
  const sources = process.env.JOB_SOURCES_JSON ? JSON.parse(process.env.JOB_SOURCES_JSON) : DEFAULT_SOURCES;
  const collected = await collectFromSources(sources, now);
  const verifiedCurrent = await verifyExistingJobs(current.jobs || [], now);
  const merged = mergeJobs(verifiedCurrent, collected.jobs, now);
  const snapshot = buildSnapshot({ jobs: merged, generatedAt: now.toISOString() }, now);
  assertHealthyChange(Number(current.count || current.jobs?.length || 0), snapshot.count);

  if (sameJobs(current.jobs || [], snapshot.jobs)) {
    console.log(`Checked ${collected.status.length} sources; no verified listing changes.`);
    return;
  }

  snapshot.sources = collected.status;
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
  console.log(`Published ${snapshot.count} jobs from ${collected.status.filter(item => item.ok).length}/${collected.status.length} reachable sources.`);
}

const isCommandLine = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCommandLine) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
