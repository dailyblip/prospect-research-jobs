const state = {
  jobs: [],
  generatedAt: null,
  filters: {
    search: '',
    workMode: '',
    jobType: '',
    experience: '',
    location: '',
    sort: 'newest'
  }
};

const elements = {
  search: document.querySelector('#search-input'),
  workMode: document.querySelector('#work-mode-filter'),
  jobType: document.querySelector('#job-type-filter'),
  experience: document.querySelector('#experience-filter'),
  location: document.querySelector('#location-filter'),
  sort: document.querySelector('#sort-order'),
  reset: document.querySelector('#reset-filters'),
  results: document.querySelector('#job-results'),
  empty: document.querySelector('#empty-state'),
  count: document.querySelector('#active-count'),
  updated: document.querySelector('#updated-at'),
  year: document.querySelector('#copyright-year')
};

elements.year.textContent = String(new Date().getFullYear());

function text(value, fallback = '') {
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function normalized(value) {
  return text(value).toLocaleLowerCase();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const date = new Date(isoDateOnly);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return 'Date not listed';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function isNew(job) {
  const date = parseDate(job.dateAdded);
  if (!date) return false;
  const age = Date.now() - date.getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}

function splitTags(value) {
  const values = Array.isArray(value) ? value : text(value).split(/[,|]/);
  return [...new Set(values.map(tag => text(tag)).filter(Boolean))].slice(0, 8);
}

function deriveJobType(job) {
  const haystack = normalized(`${job.title} ${job.tags}`);
  if (haystack.includes('prospect management')) return 'Prospect Management';
  if (haystack.includes('prospect development')) return 'Prospect Development';
  if (haystack.includes('advancement analytics') || haystack.includes('fundraising analytics')) return 'Advancement Analytics';
  if (haystack.includes('prospect research') || haystack.includes('development research')) return 'Prospect Research';
  return 'Other';
}

function deriveExperience(job) {
  const title = normalized(job.title);
  if (/\b(chief|vice president|vp|executive)\b/.test(title)) return 'Executive';
  if (/\b(director|avp)\b/.test(title)) return 'Director';
  if (/\b(manager|lead|head)\b/.test(title)) return 'Manager';
  if (/\b(senior|sr\.?|principal)\b/.test(title)) return 'Senior';
  return 'Individual Contributor';
}

function normalizeJob(job) {
  return {
    title: text(job.title, 'Untitled position'),
    employer: text(job.employer, 'Employer not listed'),
    location: text(job.location, 'Location not listed'),
    workMode: text(job.workMode, 'Unknown'),
    salaryRange: text(job.salaryRange, 'Not listed'),
    postedDate: text(job.postedDate),
    dateAdded: text(job.dateAdded),
    source: text(job.source, 'Source not listed'),
    sourceUrl: safeHttpUrl(job.sourceUrl),
    applyUrl: safeHttpUrl(job.applyUrl),
    summary: text(job.summary),
    tags: splitTags(job.tags)
  };
}

function createElement(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function jobCard(job) {
  const article = createElement('article', 'job-card');
  const top = createElement('div', 'job-card-top');
  const body = createElement('div', 'job-body');
  const titleRow = createElement('div', 'job-title-row');
  titleRow.append(createElement('h3', 'job-title', job.title));
  if (isNew(job)) titleRow.append(createElement('span', 'new-badge', 'NEW'));
  body.append(titleRow, createElement('p', 'job-employer', job.employer));

  const metaParts = [job.location, job.workMode, job.salaryRange === 'Not listed' ? 'Salary not listed' : job.salaryRange];
  body.append(createElement('p', 'job-meta', metaParts.join(' · ')));
  if (job.summary) body.append(createElement('p', 'job-summary', job.summary));

  const source = createElement('p', 'job-source');
  source.append(document.createTextNode('Source: '));
  if (job.sourceUrl) {
    const sourceLink = createElement('a', '', job.source);
    sourceLink.href = job.sourceUrl;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    source.append(sourceLink);
  } else {
    source.append(document.createTextNode(job.source));
  }
  body.append(source);

  const tags = createElement('div', 'tags');
  job.tags.forEach(label => tags.append(createElement('span', 'tag', label)));
  if (job.tags.length) body.append(tags);

  const actions = createElement('div', 'job-actions');
  actions.append(createElement('span', 'job-date', formatDate(job.postedDate)));
  if (job.applyUrl) {
    const apply = createElement('a', 'button view-job', 'View Job');
    apply.href = job.applyUrl;
    apply.target = '_blank';
    apply.rel = 'noopener noreferrer';
    actions.append(apply);
  }

  top.append(body, actions);
  article.append(top);
  return article;
}

function populateLocations() {
  const locations = [...new Set(state.jobs.map(job => job.location).filter(location => location !== 'Location not listed'))]
    .sort((a, b) => a.localeCompare(b));
  locations.forEach(location => {
    const option = createElement('option', '', location);
    option.value = location;
    elements.location.append(option);
  });
}

function filteredJobs() {
  const query = normalized(state.filters.search);
  const filtered = state.jobs.filter(job => {
    const searchText = normalized([
      job.title,
      job.employer,
      job.location,
      job.workMode,
      job.summary,
      job.source,
      ...job.tags
    ].join(' '));

    return (!query || searchText.includes(query))
      && (!state.filters.workMode || job.workMode === state.filters.workMode)
      && (!state.filters.jobType || deriveJobType(job) === state.filters.jobType)
      && (!state.filters.experience || deriveExperience(job) === state.filters.experience)
      && (!state.filters.location || job.location === state.filters.location);
  });

  return filtered.sort((a, b) => {
    if (state.filters.sort === 'title') return a.title.localeCompare(b.title);
    if (state.filters.sort === 'posted') return (parseDate(b.postedDate)?.getTime() || 0) - (parseDate(a.postedDate)?.getTime() || 0);
    return (parseDate(b.dateAdded)?.getTime() || 0) - (parseDate(a.dateAdded)?.getTime() || 0);
  });
}

function render() {
  const jobs = filteredJobs();
  elements.results.replaceChildren(...jobs.map(jobCard));
  elements.results.setAttribute('aria-busy', 'false');
  elements.count.textContent = String(jobs.length);
  elements.empty.hidden = jobs.length !== 0;
}

function resetFilters() {
  elements.search.value = '';
  elements.workMode.value = '';
  elements.jobType.value = '';
  elements.experience.value = '';
  elements.location.value = '';
  elements.sort.value = 'newest';
  state.filters = { search: '', workMode: '', jobType: '', experience: '', location: '', sort: 'newest' };
  render();
}

function bindFilters() {
  const inputs = [
    [elements.search, 'search', 'input'],
    [elements.workMode, 'workMode', 'change'],
    [elements.jobType, 'jobType', 'change'],
    [elements.experience, 'experience', 'change'],
    [elements.location, 'location', 'change'],
    [elements.sort, 'sort', 'change']
  ];

  inputs.forEach(([element, key, eventName]) => {
    element.addEventListener(eventName, () => {
      state.filters[key] = element.value;
      render();
    });
  });

  elements.reset.addEventListener('click', resetFilters);
  document.querySelectorAll('[data-reset-filters]').forEach(button => button.addEventListener('click', resetFilters));
}

async function loadJobs() {
  try {
    const response = await fetch(`data/jobs.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Jobs request failed with ${response.status}`);
    const payload = await response.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    state.jobs = jobs.map(normalizeJob).filter(job => job.applyUrl);
    state.generatedAt = payload.generatedAt || null;
    populateLocations();
    elements.updated.textContent = state.generatedAt
      ? `Updated ${formatDate(state.generatedAt)}`
      : 'Updated automatically from approved public listings';
  } catch (error) {
    console.error(error);
    state.jobs = [];
    elements.updated.textContent = 'Listings are temporarily unavailable. Please check back shortly.';
  }

  render();
}

bindFilters();
loadJobs();
