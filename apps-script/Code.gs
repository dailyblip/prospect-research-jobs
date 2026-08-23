const PUBLIC_SITE_URL = 'https://prospectresearchjobs.com/';

function doGet(e) {
  const format = String(e && e.parameter && e.parameter.format || '').trim().toLowerCase();

  if (format === 'json') {
    return ContentService
      .createTextOutput(JSON.stringify(buildPublicJobsFeed_()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Prospect Research Jobs')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const action = String(e && e.parameter && e.parameter.action || '').trim().toLowerCase();

  if (action !== 'subscribe') {
    return buildPublicFormResponse_(false, 'Unsupported request.');
  }

  const email = String(e && e.parameter && e.parameter.email || '').trim();
  const result = addSubscriber(email);
  return buildPublicFormResponse_(result.success, result.message);
}

function buildPublicJobsFeed_() {
  const jobs = getJobs()
    .map(job => ({
      status: String(job['Status'] || '').trim(),
      title: String(job['Job Title'] || '').trim(),
      employer: String(job['Employer'] || '').trim(),
      location: String(job['Location'] || '').trim(),
      workMode: String(job['Work Mode'] || '').trim(),
      salaryRange: String(job['Salary Range'] || '').trim(),
      postedDate: String(job['Posted Date'] || '').trim(),
      dateAdded: String(job['Date Added'] || '').trim(),
      source: String(job['Source'] || '').trim(),
      sourceUrl: String(job['Source URL'] || '').trim(),
      applyUrl: String(job['Apply URL'] || '').trim(),
      summary: String(job['Summary'] || '').trim(),
      tags: String(job['Tags'] || '').trim()
    }))
    .filter(job => job.title && job.employer && job.source && job.applyUrl);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    count: jobs.length,
    jobs: jobs
  };
}

function buildPublicFormResponse_(success, message) {
  const title = success ? 'You are subscribed' : 'Subscription problem';
  const safeMessage = escapePublicHtml_(message || 'Please try again.');

  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{margin:0;background:#F6F3EC;color:#252A2E;font-family:Arial,sans-serif}' +
    'main{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #DDD6C8;border-radius:14px}' +
    'a{color:#2F5D7C;font-weight:700}</style></head><body><main>' +
    '<h1>' + title + '</h1><p>' + safeMessage + '</p>' +
    '<p><a href="' + PUBLIC_SITE_URL + '">Return to Prospect Research Jobs</a></p>' +
    '</main></body></html>'
  ).setTitle(title);
}

function escapePublicHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Job Board')
    .addItem('Import Jobs with AI', 'importJobs')
    .addItem('Import Google Alert RSS', 'importGoogleAlertRSS')
    .addItem('Enrich Unknown Fields', 'enrichUnknownFields')
    .addItem('Dedupe Jobs', 'dedupeJobsAgent')
    .addItem('Archive Old Jobs', 'archiveOldJobs')
    .addItem('Send Weekly Digest', 'sendWeeklyDigest')
    .addItem('Auto-Review Pending Jobs', 'autoReviewPendingJobs')
    .addItem('Test OpenAI Key', 'testOpenAIKey')
    .addItem('Debug Jobs', 'debugJobs')
    .addSeparator()
    .addItem('Reset Import Progress (start fresh)', 'resetImportProgress')
    .addSeparator()
    .addItem('Enable Daily Automation', 'setupDailyAutomation')
    .addItem('Disable Daily Automation', 'disableDailyAutomation')
    .addItem('Run Full Pipeline Now', 'runAutomationPipeline')
    .addToUi();
}

function getJobs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Jobs');

  if (!sheet) return [];

  ensureJobHeaders(sheet);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return data.slice(1)
    .map(row => {
      let job = {};
      headers.forEach((header, i) => job[header] = row[i]);
      return job;
    })
    .filter(job => {
      const status = String(job['Status'] || '').trim().toLowerCase();
      if (status !== 'active') return false;

      const postedDate = new Date(job['Posted Date']);
      if (isNaN(postedDate)) return true;

      postedDate.setHours(0, 0, 0, 0);
      const ageDays = Math.floor((today - postedDate) / (1000 * 60 * 60 * 24));

      return ageDays <= 30;
    })
    .sort((a, b) => {
      const dateA = new Date(a['Date Added']);
      const dateB = new Date(b['Date Added']);

      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;

      return dateB - dateA;
    });
}

function addSubscriber(email) {
  email = String(email || '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return { success: false, message: 'Please enter a valid email address.' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Subscribers');

  if (!sheet) {
    sheet = ss.insertSheet('Subscribers');
    sheet.getRange(1, 1, 1, 4).setValues([[
      'Email',
      'Date Joined',
      'Status',
      'Source'
    ]]);
  }

  const data = sheet.getDataRange().getDisplayValues();
  const existing = data.slice(1).some(row => String(row[0]).trim().toLowerCase() === email);

  if (existing) {
    return { success: true, message: 'You are already subscribed.' };
  }

  sheet.appendRow([email, new Date(), 'Active', 'Website']);

  return { success: true, message: 'Thanks — you are subscribed.' };
}

// --------------------------------------------------------------------------
// FIXED: Apps Script kills any execution running longer than ~6 minutes
// (consumer accounts) or 30 minutes (Workspace accounts). With 14 sources,
// each fetching up to 25 detail pages and making an OpenAI call per
// candidate, a full run can easily exceed that. Two changes fix this:
//
// 1. Jobs are now written to the sheet after EACH source finishes, instead
//    of being held in memory and only written once at the very end. If the
//    run gets cut off, work already done is not lost.
// 2. The function tracks elapsed time and a list of "remaining sources" in
//    Script Properties. If it's running low on time, it stops cleanly after
//    finishing the current source, saves which sources are left, and tells
//    you to run "Import Jobs with AI" again to continue. The next run picks
//    up only the remaining sources instead of starting over from source #1.
//
// Use "Reset Import Progress" from the menu if you want to force a full
// restart from all sources instead of resuming.
// --------------------------------------------------------------------------
const IMPORT_TIME_BUDGET_MS = 4.5 * 60 * 1000; // stop with a safety buffer before the 6-minute hard limit
const STAGE_TIME_BUDGET_MS = 4.5 * 60 * 1000; // same buffer, used by the enrich and review stages
const PENDING_SOURCES_PROP = 'PENDING_IMPORT_SOURCES';

function importJobs() {
  const result = runImportCore();

  if (result.finished) {
    safeAlert(result.totalImported + ' jobs imported as Needs Review. All sources processed. Check Import Log.');
  } else {
    safeAlert(
      result.totalImported + ' jobs imported this run, but the script paused before finishing all sources ' +
      '(to stay under the execution time limit). Run "Import Jobs with AI" again to continue with the ' +
      'remaining sources — it will not restart from the beginning.'
    );
  }
}

// Does the actual work of importing jobs and returns a result object instead
// of showing a UI alert directly. This lets the same logic be called either
// from the menu (importJobs, above) or from an automated trigger (which has
// no UI to alert).
function runImportCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName('Jobs');

  if (!jobsSheet) throw new Error('No sheet tab named Jobs found.');

  ensureJobHeaders(jobsSheet);

  const logSheet = getOrCreateImportLogSheet(ss);
  const props = PropertiesService.getScriptProperties();

  const savedSources = getPendingSources(props);
  const isResuming = savedSources !== null;
  const sources = isResuming ? savedSources : getJobSources();

  if (!isResuming) {
    resetImportLog(logSheet);
  } else {
    logImport(logSheet, 'SYSTEM', '', 'RESUMING', sources.length + ' source(s) left from previous run.');
  }

  const startTime = Date.now();
  let existingKeys = getExistingJobKeys(jobsSheet);
  let totalImportedThisRun = 0;
  let stoppedEarly = false;
  let sourcesProcessed = 0;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceImportedJobs = [];

    try {
      logImport(logSheet, source.name, source.url, 'SOURCE START', '');

      const html = fetchUrl(source.url);

      let candidates = [];

      if (source.parser === 'cara') {
        candidates = extractCARAJobs(html, source);
      } else {
        candidates = extractJobsFromHtml(html, source);
      }

      logImport(logSheet, source.name, source.url, 'CANDIDATES FOUND', candidates.length);

      if (candidates.length === 0) {
        logImport(
          logSheet,
          source.name,
          source.url,
          'NOTE',
          'Zero candidates found. This usually means the page renders its listings with ' +
          'JavaScript (Apps Script only sees the raw HTML and cannot execute scripts), or the ' +
          'link/text patterns on this page do not match the extraction rules. Worth checking the ' +
          'page manually and, if it is JS-rendered, looking for an RSS/API feed instead.'
        );
      }

      candidates.forEach(candidate => {
        try {
          if (!candidate.applyUrl) {
            logImport(logSheet, source.name, source.url, 'SKIPPED', 'Missing apply URL for ' + candidate.title);
            return;
          }

          const detailHtml = fetchUrl(candidate.applyUrl);
          const detailText = htmlToText(detailHtml);

          let cleaned = null;
          let aiStatus = 'AI not run';

          try {
            cleaned = cleanJobWithAI(candidate, detailText);
            aiStatus = 'AI success';
          } catch (aiError) {
            aiStatus = 'AI failed: ' + aiError.message;
          }

          const finalJob = buildFinalJob(candidate, cleaned, detailText, source);
          const key = makeJobKey(finalJob);

          if (existingKeys.has(key)) {
            logImport(logSheet, source.name, candidate.applyUrl, 'DUPLICATE SKIPPED', finalJob.title);
            return;
          }

          if (!shouldImportJob(candidate, cleaned, detailText)) {
            logImport(logSheet, source.name, candidate.applyUrl, 'REJECTED', finalJob.title);
            return;
          }

          sourceImportedJobs.push(finalJob);
          existingKeys.add(key);

          logImport(logSheet, source.name, candidate.applyUrl, 'IMPORTED', aiStatus + ' | ' + finalJob.title);

        } catch (detailError) {
          logImport(logSheet, source.name, candidate.applyUrl || source.url, 'DETAIL FAILED', detailError.message);
        }
      });

    } catch (sourceError) {
      logImport(logSheet, source.name, source.url, 'SOURCE FAILED', sourceError.message);
    }

    // Write this source's jobs immediately so nothing is lost if we time out
    // before reaching the end of the source list.
    if (sourceImportedJobs.length > 0) {
      appendImportedJobs(jobsSheet, sourceImportedJobs);
      totalImportedThisRun += sourceImportedJobs.length;
    }

    sourcesProcessed++;

    const elapsed = Date.now() - startTime;
    const sourcesRemaining = sources.slice(sourcesProcessed);

    if (elapsed > IMPORT_TIME_BUDGET_MS && sourcesRemaining.length > 0) {
      savePendingSources(props, sourcesRemaining);
      logImport(
        logSheet,
        'SYSTEM',
        '',
        'PAUSED FOR TIME',
        sourcesRemaining.length + ' source(s) remaining. Run "Import Jobs with AI" again to continue.'
      );
      stoppedEarly = true;
      break;
    }
  }

  if (!stoppedEarly) {
    clearPendingSources(props);
  }

  return { totalImported: totalImportedThisRun, finished: !stoppedEarly };
}

function getPendingSources(props) {
  const raw = props.getProperty(PENDING_SOURCES_PROP);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (error) {
    return null;
  }
}

function savePendingSources(props, sources) {
  props.setProperty(PENDING_SOURCES_PROP, JSON.stringify(sources));
}

function clearPendingSources(props) {
  props.deleteProperty(PENDING_SOURCES_PROP);
}

function resetImportProgress() {
  PropertiesService.getScriptProperties().deleteProperty(PENDING_SOURCES_PROP);
  safeAlert('Import progress cleared. The next "Import Jobs with AI" run will start fresh from all sources.');
}

// Shows a UI alert when a UI is available (menu-triggered runs). When called
// from an automated time-based trigger there is no UI to alert, so it falls
// back to writing a row in the Import Log instead of throwing an error.
function safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    logAutomationEvent(message);
  }
}

function logAutomationEvent(message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = getOrCreateImportLogSheet(ss);
    logSheet.appendRow([new Date(), 'AUTOMATION', '', 'INFO', message]);
  } catch (error) {
    Logger.log(message);
  }
}

// ============================================================================
// DAILY AUTOMATION PIPELINE
//
// Runs the four steps (import → RSS import → enrich → auto-review) with
// minimal human involvement. Each step already knows how to pause itself
// before hitting the 6-minute execution limit and resume later; this
// orchestrator just chains the steps together and reschedules itself via a
// short-delay trigger whenever a step isn't finished yet, or when moving on
// to the next step. A safety cap prevents a stuck stage from rescheduling
// itself forever.
//
// What still needs a human: any row left as "Needs Review" or with a
// low-confidence note after the auto-review stage. Everything else — running
// the imports, cleaning up fields, approving obvious matches, and rejecting
// obvious junk — happens on its own.
// ============================================================================

const STAGE_PROP = 'AUTOMATION_STAGE';
const HOP_COUNT_PROP = 'AUTOMATION_HOP_COUNT';
const CONTINUATION_TRIGGER_PROP = 'AUTOMATION_CONTINUATION_TRIGGER_ID';
const KICKOFF_TRIGGER_PROP = 'AUTOMATION_KICKOFF_TRIGGER_ID';
const MAX_HOPS_PER_DAY = 40; // safety cap so a stuck stage can't reschedule itself indefinitely
const STAGE_ORDER = ['IMPORT', 'RSS', 'ENRICH', 'DEDUPE', 'ARCHIVE', 'REVIEW'];

// Apps Script time-based triggers normally fire according to the SCRIPT
// PROJECT's own time zone setting (Project Settings → Time zone), not a
// value passed in code — so a naive .atHour(6).everyDays(1) trigger would
// run at 6 AM in whatever zone the project happens to be set to, which may
// not be Pacific. To guarantee this always fires at 6 AM Pacific regardless
// of the project's setting, we don't use a recurring trigger at all. Instead,
// each run computes the exact UTC instant for the next 6 AM in
// 'America/Los_Angeles' (which correctly handles the PST/PDT switch via the
// IANA time zone database) and schedules a one-time trigger for that moment.
// After each day's pipeline finishes, it schedules tomorrow's run the same
// way — so the schedule is self-perpetuating and always correct.
const AUTOMATION_TIMEZONE = 'America/Los_Angeles';
const AUTOMATION_HOUR = 6; // 24-hour clock, Pacific time

// Computes the next UTC instant at which it will be `hour`:00 wall-clock time
// in `timeZone`. Self-correcting via a couple of iterations so it's accurate
// across DST transitions without any hardcoded offset.
function getNextRunInstant(hour, timeZone) {
  const now = new Date();

  const nowParts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now).forEach(p => { if (p.type !== 'literal') nowParts[p.type] = p.value; });

  const year = Number(nowParts.year);
  const month = Number(nowParts.month);
  const currentHour = Number(nowParts.hour === '24' ? '0' : nowParts.hour);
  const currentMinute = Number(nowParts.minute);
  let targetDay = Number(nowParts.day);

  if (currentHour > hour || (currentHour === hour && currentMinute >= 0)) {
    targetDay += 1; // target hour has already passed today (in that time zone) — use tomorrow
  }

  let guess = new Date(Date.UTC(year, month - 1, targetDay, hour, 0, 0));

  for (let i = 0; i < 3; i++) {
    const checkParts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(guess).forEach(p => { if (p.type !== 'literal') checkParts[p.type] = p.value; });

    const actualDay = Number(checkParts.day);
    const actualHour = Number(checkParts.hour === '24' ? '0' : checkParts.hour);
    const actualMinute = Number(checkParts.minute);

    const diffMinutes = (targetDay - actualDay) * 24 * 60 + (hour - actualHour) * 60 - actualMinute;
    if (diffMinutes === 0) break;
    guess = new Date(guess.getTime() + diffMinutes * 60 * 1000);
  }

  return guess;
}

// Schedules (or reschedules) the trigger that kicks off tomorrow's run,
// cleaning up the previous kickoff trigger first so they don't accumulate.
function scheduleNextDailyKickoff(props) {
  const oldId = props.getProperty(KICKOFF_TRIGGER_PROP);
  if (oldId) {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getUniqueId() === oldId) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  const nextRun = getNextRunInstant(AUTOMATION_HOUR, AUTOMATION_TIMEZONE);
  const trigger = ScriptApp.newTrigger('runAutomationPipeline')
    .timeBased()
    .at(nextRun)
    .create();

  props.setProperty(KICKOFF_TRIGGER_PROP, trigger.getUniqueId());
  return nextRun;
}

function runAutomationPipeline() {
  const props = PropertiesService.getScriptProperties();
  const stage = props.getProperty(STAGE_PROP) || 'IMPORT';
  const hopCount = Number(props.getProperty(HOP_COUNT_PROP) || '0');

  if (hopCount >= MAX_HOPS_PER_DAY) {
    logAutomationEvent(
      'Automation stopped: exceeded ' + MAX_HOPS_PER_DAY + ' continuation attempts without finishing. ' +
      'Something is likely stuck (check the Import Log above for repeated errors). Clearing state — ' +
      'the pipeline will start fresh from the next scheduled daily run, or you can run it manually now.'
    );
    clearAutomationState(props);
    return;
  }

  props.setProperty(HOP_COUNT_PROP, String(hopCount + 1));

  let stageFinished = true;

  try {
    if (stage === 'IMPORT') {
      const result = runImportCore();
      stageFinished = result.finished;
      if (stageFinished) {
        logAutomationEvent('Daily automation: import stage complete (' + result.totalImported + ' jobs imported this pass).');
      }
    } else if (stage === 'RSS') {
      const result = runImportRSSCore();
      stageFinished = true;
      logAutomationEvent('Daily automation: RSS stage complete (' + result.totalImported + ' jobs imported).');
    } else if (stage === 'ENRICH') {
      const result = runEnrichCore();
      stageFinished = result.finished;
      if (stageFinished) {
        logAutomationEvent(
          'Daily automation: enrichment stage complete. Updated ' + result.updated +
          ', skipped ' + result.skipped + ', failed ' + result.failed + '.'
        );
      }
    } else if (stage === 'DEDUPE') {
      const result = runDedupeCore();
      stageFinished = true;
      logAutomationEvent('Daily automation: dedupe stage complete. Duplicates marked: ' + result.duplicatesMarked + '.');
    } else if (stage === 'ARCHIVE') {
      const result = runArchiveOldJobsCore();
      stageFinished = true;
      logAutomationEvent('Daily automation: archive stage complete. Jobs archived: ' + result.archived + '.');
    } else if (stage === 'REVIEW') {
      const result = runReviewCore();
      stageFinished = result.finished;
      if (stageFinished) {
        logAutomationEvent(
          'Daily automation: auto-review stage complete. Approved ' + result.approved +
          ', kept for review ' + result.keptForReview + ', rejected ' + result.rejected + '.'
        );
      }
    } else {
      // Unrecognized stage value somehow — reset to be safe.
      logAutomationEvent('Daily automation: unrecognized stage "' + stage + '". Resetting to IMPORT.');
      props.setProperty(STAGE_PROP, 'IMPORT');
      stageFinished = false;
    }
  } catch (error) {
    logAutomationEvent('Daily automation error during ' + stage + ' stage: ' + error.message + '. Will retry this stage shortly.');
    stageFinished = false;
  }

  if (stageFinished) {
    const currentIndex = STAGE_ORDER.indexOf(stage);
    const nextStage = STAGE_ORDER[currentIndex + 1];

    if (nextStage) {
      props.setProperty(STAGE_PROP, nextStage);
      scheduleContinuation(props, 1);
    } else {
      logAutomationEvent('Daily automation complete: all stages finished for today.');
      clearAutomationState(props);
    }
  } else {
    scheduleContinuation(props, 5);
  }
}

// Schedules a one-time trigger to call runAutomationPipeline again shortly.
// Cleans up any previously scheduled continuation trigger first so they
// don't accumulate — but never touches the recurring daily kickoff trigger,
// since that one's ID is never stored in CONTINUATION_TRIGGER_PROP.
function scheduleContinuation(props, minutesFromNow) {
  const oldTriggerId = props.getProperty(CONTINUATION_TRIGGER_PROP);

  if (oldTriggerId) {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getUniqueId() === oldTriggerId) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  const trigger = ScriptApp.newTrigger('runAutomationPipeline')
    .timeBased()
    .after(minutesFromNow * 60 * 1000)
    .create();

  props.setProperty(CONTINUATION_TRIGGER_PROP, trigger.getUniqueId());
}

function clearAutomationState(props) {
  props.deleteProperty(STAGE_PROP);
  props.deleteProperty(HOP_COUNT_PROP);
  props.deleteProperty(CONTINUATION_TRIGGER_PROP);
}

// Sets up the recurring daily trigger that kicks off the whole pipeline.
// Safe to run more than once — it clears out any existing triggers for this
// function first so you don't end up with duplicates.
function setupDailyAutomation() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runAutomationPipeline') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const props = PropertiesService.getScriptProperties();
  clearAutomationState(props);
  clearPendingSources(props);
  props.deleteProperty(ENRICH_RESUME_PROP);
  props.deleteProperty(REVIEW_RESUME_PROP);

  ScriptApp.newTrigger('runAutomationPipeline')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  safeAlert(
    'Daily automation enabled. Starting at approximately 6:00 AM (script time zone) each day, this will ' +
    'automatically:\n\n' +
    '1. Import new jobs from all sources\n' +
    '2. Import Google Alert RSS results\n' +
    '3. Enrich missing fields with AI\n' +
    '4. Mark duplicates before review\n' +
    '5. Archive old jobs\n' +
    '6. Auto-review pending jobs — approving high-confidence matches, rejecting clear junk, and leaving ' +
    'genuinely ambiguous ones as "Needs human review" for you\n\n' +
    'Because each step can take a while, the pipeline may pause and resume itself several times via ' +
    'short follow-up triggers until it finishes — that\'s expected, not an error.\n\n' +
    'You only need to check the sheet periodically and approve/adjust rows the AI left flagged — ' +
    'everything else runs on its own. Use "Run Full Pipeline Now" if you want to trigger it immediately ' +
    'instead of waiting for the next scheduled run.'
  );
}

function disableDailyAutomation() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runAutomationPipeline') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const props = PropertiesService.getScriptProperties();
  clearAutomationState(props);

  safeAlert('Daily automation disabled. No further automatic runs will occur until you enable it again.');
}

function importGoogleAlertRSS() {
  const result = runImportRSSCore();
  safeAlert(result.totalImported + ' Google Alert RSS jobs imported as Needs Review. Check Import Log.');
}

// Same reasoning as runImportCore: separates the work from the UI alert so
// this can be called from an automated trigger. Note this does NOT clear the
// Import Log — it's designed to run right after the main job import as part
// of the same pipeline, sharing one log for the day.
function runImportRSSCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName('Jobs');

  if (!jobsSheet) throw new Error('No sheet tab named Jobs found.');

  ensureJobHeaders(jobsSheet);

  const logSheet = getOrCreateImportLogSheet(ss);

  const feeds = getGoogleAlertFeeds();
  const existingKeys = getExistingJobKeys(jobsSheet);
  const importedJobs = [];

  feeds.forEach(feed => {
    try {
      logImport(logSheet, feed.name, feed.url, 'RSS START', '');

      const xmlText = fetchUrl(feed.url);
      const candidates = extractGoogleAlertRSSCandidates(xmlText, feed);

      logImport(logSheet, feed.name, feed.url, 'RSS ITEMS FOUND', candidates.length);

      if (candidates.length === 0) {
        logImport(
          logSheet,
          feed.name,
          feed.url,
          'NOTE',
          'Zero RSS items found. Confirm the Google Alert is still active and delivering results, ' +
          'and that the feed URL has not expired or changed.'
        );
      }

      candidates.forEach(candidate => {
        try {
          if (!candidate.applyUrl) {
            logImport(logSheet, feed.name, feed.url, 'SKIPPED', 'Missing URL for RSS item: ' + candidate.title);
            return;
          }

          let detailText = candidate.rssText || '';
          let fetchStatus = 'RSS text only';

          try {
            const detailHtml = fetchUrl(candidate.applyUrl);
            detailText = htmlToText(detailHtml) + '\n\nRSS Context:\n' + candidate.rssText;
            fetchStatus = 'Fetched result page';
          } catch (fetchError) {
            logImport(logSheet, feed.name, candidate.applyUrl, 'FETCH FALLBACK', fetchError.message);
          }

          let cleaned = null;
          let aiStatus = 'AI not run';

          try {
            cleaned = cleanJobWithAI(candidate, detailText);
            aiStatus = 'AI success';
          } catch (aiError) {
            aiStatus = 'AI failed: ' + aiError.message;
          }

          const finalJob = buildFinalJob(candidate, cleaned, detailText, {
            name: feed.name,
            url: feed.url
          });

          const key = makeJobKey(finalJob);

          if (existingKeys.has(key)) {
            logImport(logSheet, feed.name, candidate.applyUrl, 'DUPLICATE SKIPPED', finalJob.title);
            return;
          }

          if (!shouldImportJob(candidate, cleaned, detailText)) {
            logImport(logSheet, feed.name, candidate.applyUrl, 'REJECTED', finalJob.title);
            return;
          }

          importedJobs.push(finalJob);
          existingKeys.add(key);

          logImport(
            logSheet,
            feed.name,
            candidate.applyUrl,
            'IMPORTED',
            aiStatus + ' | ' + fetchStatus + ' | ' + finalJob.title
          );

        } catch (itemError) {
          logImport(logSheet, feed.name, candidate.applyUrl || feed.url, 'RSS ITEM FAILED', itemError.message);
        }
      });

    } catch (feedError) {
      logImport(logSheet, feed.name, feed.url, 'RSS FAILED', feedError.message);
    }
  });

  appendImportedJobs(jobsSheet, importedJobs);

  return { totalImported: importedJobs.length };
}

function getGoogleAlertFeeds() {
  return [
    {
      name: 'Google Alert RSS - Prospect Research Jobs',
      url: 'https://www.google.com/alerts/feeds/06888626139022071782/1681515106666237480'
    }
  ];
}

function extractGoogleAlertRSSCandidates(xmlText, feed) {
  const candidates = [];

  const document = XmlService.parse(xmlText);
  const root = document.getRootElement();
  const atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');

  const entries = root.getChildren('entry', atom);

  entries.forEach(entry => {
    const title = getAtomText(entry, 'title', atom);
    const summary = getAtomText(entry, 'summary', atom);
    const content = getAtomText(entry, 'content', atom);
    const published = getAtomText(entry, 'published', atom);
    const updated = getAtomText(entry, 'updated', atom);

    let href = '';

    const links = entry.getChildren('link', atom);
    links.forEach(link => {
      const rel = link.getAttribute('rel');
      const hrefAttr = link.getAttribute('href');

      if (!hrefAttr) return;

      if (!rel || rel.getValue() === 'alternate') {
        href = hrefAttr.getValue();
      }
    });

    const applyUrl = unwrapGoogleAlertUrl(href);
    const rssText = htmlToText(title + '\n' + summary + '\n' + content);

    if (!title && !rssText) return;

    candidates.push({
      title: cleanPossibleTitle(title || 'Google Alert Result'),
      employer: 'Review needed',
      location: 'Review needed',
      workMode: inferWorkMode(rssText),
      salary: 'Review needed',
      postedDate: published || updated || new Date(),
      source: feed.name,
      sourceUrl: feed.url,
      applyUrl: applyUrl,
      summary: rssText.substring(0, 300),
      tags: inferTags(title + ' ' + rssText),
      rssText: rssText
    });
  });

  return dedupeJobs(candidates).slice(0, 25);
}

function getAtomText(entry, childName, namespace) {
  const child = entry.getChild(childName, namespace);
  if (!child) return '';
  return child.getText() || '';
}

function unwrapGoogleAlertUrl(url) {
  if (!url) return '';

  const decoded = decodeEntities(url);

  const urlMatch = decoded.match(/[?&](url|q|u)=([^&]+)/i);

  if (urlMatch && urlMatch[2]) {
    try {
      return decodeURIComponent(urlMatch[2]);
    } catch (error) {
      return urlMatch[2];
    }
  }

  return decoded;
}

const ENRICH_RESUME_PROP = 'ENRICH_RESUME_ROW';

function enrichUnknownFields() {
  const result = runEnrichCore();

  if (result.totalRows === 0) {
    safeAlert('No jobs found.');
    return;
  }

  if (result.finished) {
    safeAlert(
      'Enrichment complete.\n\n' +
      'Rows updated: ' + result.updated + '\n' +
      'Rows skipped: ' + result.skipped + '\n' +
      'Rows failed: ' + result.failed
    );
  } else {
    safeAlert(
      'Enrichment paused before finishing all rows (time limit). So far — updated: ' + result.updated +
      ', skipped: ' + result.skipped + ', failed: ' + result.failed + '.\n\n' +
      'Run "Enrich Unknown Fields" again to continue where it left off, or let the daily automation handle it.'
    );
  }
}

// FIXED (same reasoning as importJobs): a sheet with many rows needing
// enrichment can also exceed the 6-minute execution limit doing one
// fetch + one AI call per row. This version tracks a resume row number in
// Script Properties, so a timed-out run picks up where it left off instead
// of reprocessing rows (or losing track) on the next call.
function runEnrichCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Jobs');

  if (!sheet) throw new Error('No Jobs sheet found.');

  ensureJobHeaders(sheet);

  const data = sheet.getDataRange().getDisplayValues();

  if (data.length < 2) {
    return { finished: true, updated: 0, skipped: 0, failed: 0, totalRows: 0 };
  }

  const headers = data[0].map(h => String(h).trim());

  const fieldsToCheck = [
    'Employer',
    'Location',
    'Work Mode',
    'Salary Range',
    'Posted Date',
    'Summary',
    'Tags'
  ];

  const notesCol = headers.indexOf('Review Notes') + 1;

  const props = PropertiesService.getScriptProperties();
  const resumeRaw = props.getProperty(ENRICH_RESUME_PROP);
  const startRowNumber = resumeRaw ? Number(resumeRaw) : 2;

  const startTime = Date.now();
  let updatedRows = 0;
  let skippedRows = 0;
  let failedRows = 0;
  let finished = true;

  for (let rowNumber = startRowNumber; rowNumber <= data.length; rowNumber++) {
    const row = data[rowNumber - 1];

    const job = {};
    headers.forEach((header, i) => {
      job[header] = row[i];
    });

    const hasMissing = fieldsToCheck.some(field => isMissingField(job[field]));

    if (!hasMissing) {
      skippedRows++;
    } else {
      const applyUrl = String(job['Apply URL'] || '').trim();

      if (!applyUrl || !applyUrl.startsWith('http')) {
        if (notesCol > 0) {
          sheet.getRange(rowNumber, notesCol).setValue(appendNote(job['Review Notes'], 'Enrichment skipped: missing Apply URL.'));
        }
        skippedRows++;
      } else {
        try {
          const detailHtml = fetchUrl(applyUrl);
          const detailText = htmlToText(detailHtml);

          const enriched = enrichJobWithAI(job, detailText);

          const updates = [];

          fieldsToCheck.forEach(field => {
            const colIndex = headers.indexOf(field) + 1;
            if (colIndex < 1) return;

            const currentValue = job[field];
            const newValue = enriched[field];

            if (isMissingField(currentValue) && !isMissingField(newValue)) {
              sheet.getRange(rowNumber, colIndex).setValue(newValue);
              updates.push(field);
            }
          });

          if (updates.length > 0) {
            if (notesCol > 0) {
              sheet.getRange(rowNumber, notesCol).setValue(
                appendNote(
                  job['Review Notes'],
                  'AI enriched: ' + updates.join(', ') + '. Confidence: ' + enriched.confidence_score + '. ' + enriched.review_note
                )
              );
            }
            updatedRows++;
          } else {
            if (notesCol > 0) {
              sheet.getRange(rowNumber, notesCol).setValue(
                appendNote(job['Review Notes'], 'AI enrichment found no safe updates. ' + enriched.review_note)
              );
            }
            skippedRows++;
          }

        } catch (error) {
          if (notesCol > 0) {
            sheet.getRange(rowNumber, notesCol).setValue(
              appendNote(job['Review Notes'], 'AI enrichment failed: ' + error.message)
            );
          }
          failedRows++;
        }
      }
    }

    if (Date.now() - startTime > STAGE_TIME_BUDGET_MS && rowNumber < data.length) {
      props.setProperty(ENRICH_RESUME_PROP, String(rowNumber + 1));
      finished = false;
      break;
    }
  }

  if (finished) {
    props.deleteProperty(ENRICH_RESUME_PROP);
  }

  return { finished, updated: updatedRows, skipped: skippedRows, failed: failedRows, totalRows: data.length - 1 };
}

function enrichJobWithAI(job, detailText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in Script Properties.');

  const clippedText = String(detailText || '').substring(0, 12000);

  const payload = {
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content:
          'You enrich incomplete job board rows for ProspectResearchJobs.com. ' +
          'Only fill missing or unknown values using evidence from the job page text. ' +
          'Do not invent information. If not clearly stated, return "Not listed". ' +
          'Keep Summary to 1-2 clear sentences. ' +
          'Work Mode must be Remote, Hybrid, Onsite, or Unknown.'
      },
      {
        role: 'user',
        content:
          'Current job row:\n' +
          JSON.stringify(job, null, 2) +
          '\n\nJob page text:\n' +
          clippedText
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'job_enrichment',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            Employer: { type: 'string' },
            Location: { type: 'string' },
            'Work Mode': {
              type: 'string',
              enum: ['Remote', 'Hybrid', 'Onsite', 'Unknown']
            },
            'Salary Range': { type: 'string' },
            'Posted Date': { type: 'string' },
            Summary: { type: 'string' },
            Tags: { type: 'string' },
            confidence_score: { type: 'number' },
            review_note: { type: 'string' }
          },
          required: [
            'Employer',
            'Location',
            'Work Mode',
            'Salary Range',
            'Posted Date',
            'Summary',
            'Tags',
            'confidence_score',
            'review_note'
          ]
        }
      }
    },
    temperature: 0
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status >= 400) {
    throw new Error('OpenAI API error ' + status + ': ' + body.substring(0, 500));
  }

  const parsed = JSON.parse(body);
  return JSON.parse(parsed.choices[0].message.content);
}

function isMissingField(value) {
  const text = String(value || '').trim().toLowerCase();

  return (
    text === '' ||
    text === 'unknown' ||
    text === 'not listed' ||
    text === 'review needed' ||
    text === 'n/a' ||
    text === 'na' ||
    text === 'none'
  );
}

function appendNote(existingNote, newNote) {
  const existing = String(existingNote || '').trim();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  if (!existing) return stamp + ' · ' + newNote;

  return existing + '\n' + stamp + ' · ' + newNote;
}

function appendImportedJobs(sheet, jobs) {
  if (!jobs.length) return;

  ensureJobHeaders(sheet);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());

  const rows = jobs.map(job => {
    const rowObject = {
      'Status': 'Needs Review',
      'Job Title': job.title,
      'Employer': job.employer,
      'Location': job.location,
      'Work Mode': job.workMode,
      'Salary Range': job.salary,
      'Posted Date': job.postedDate,
      'Date Added': new Date(),
      'Source': job.source,
      'Source URL': job.sourceUrl,
      'Apply URL': job.applyUrl,
      'Summary': job.summary,
      'Tags': job.tags,
      'Review Notes': ''
    };

    return headers.map(header => rowObject[header] || '');
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}


// ============================================================================
// DEDUPE / ARCHIVE / DIGEST AGENTS
// ============================================================================

function dedupeJobsAgent() {
  const result = runDedupeCore();
  safeAlert(
    'Dedupe complete.\n\n' +
    'Duplicates marked: ' + result.duplicatesMarked + '\n' +
    'Groups reviewed: ' + result.groupsReviewed
  );
}

function runDedupeCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Jobs');

  if (!sheet) throw new Error('No Jobs sheet found.');

  ensureJobHeaders(sheet);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return { duplicatesMarked: 0, groupsReviewed: 0 };

  const headers = data[0].map(h => String(h).trim());
  const statusCol = headers.indexOf('Status') + 1;
  const notesCol = headers.indexOf('Review Notes') + 1;

  const rows = data.slice(1).map((row, index) => {
    const job = {};
    headers.forEach((header, i) => job[header] = row[i]);

    job.__rowNumber = index + 2;
    job.__applyUrlKey = normalizeDedupeUrl(job['Apply URL']);
    job.__titleKey = normalizeDedupeText(job['Job Title']);
    job.__employerKey = normalizeCompanyName(job['Employer']);
    job.__score = scoreJobCompleteness(job);

    return job;
  }).filter(job => {
    const status = String(job['Status'] || '').trim().toLowerCase();
    return status !== 'duplicate' && status !== 'expired' && status !== 'archived';
  });

  const groups = [];
  const byUrl = {};
  const byTitleEmployer = {};

  rows.forEach(job => {
    if (job.__applyUrlKey) {
      const key = 'url|' + job.__applyUrlKey;
      if (!byUrl[key]) byUrl[key] = [];
      byUrl[key].push(job);
    }

    if (job.__titleKey && job.__employerKey) {
      const key = 'title-employer|' + job.__titleKey + '|' + job.__employerKey;
      if (!byTitleEmployer[key]) byTitleEmployer[key] = [];
      byTitleEmployer[key].push(job);
    }
  });

  Object.keys(byUrl).forEach(key => {
    if (byUrl[key].length > 1) groups.push(byUrl[key]);
  });

  Object.keys(byTitleEmployer).forEach(key => {
    if (byTitleEmployer[key].length > 1) groups.push(byTitleEmployer[key]);
  });

  // Fuzzy pass for rows that are clearly the same title/employer but came from
  // different sources or slightly different URLs. This avoids an OpenAI call for
  // the obvious cases and keeps the dedupe agent cheap.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];

      if (!a.__titleKey || !b.__titleKey) continue;

      const titleScore = textSimilarity(a.__titleKey, b.__titleKey);
      const employerScore = textSimilarity(a.__employerKey, b.__employerKey);

      if (titleScore >= 0.88 && (employerScore >= 0.75 || a.__applyUrlKey === b.__applyUrlKey)) {
        groups.push([a, b]);
      }
    }
  }

  const alreadyMarked = new Set();
  let duplicatesMarked = 0;
  let groupsReviewed = 0;

  groups.forEach(group => {
    const uniqueGroup = [];
    const seenRows = new Set();

    group.forEach(job => {
      if (!seenRows.has(job.__rowNumber)) {
        uniqueGroup.push(job);
        seenRows.add(job.__rowNumber);
      }
    });

    if (uniqueGroup.length < 2) return;

    groupsReviewed++;

    uniqueGroup.sort((a, b) => {
      const statusDiff = statusPriority(b['Status']) - statusPriority(a['Status']);
      if (statusDiff !== 0) return statusDiff;

      const scoreDiff = b.__score - a.__score;
      if (scoreDiff !== 0) return scoreDiff;

      const dateA = new Date(a['Date Added']);
      const dateB = new Date(b['Date Added']);
      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;
      return dateA - dateB;
    });

    const keeper = uniqueGroup[0];

    uniqueGroup.slice(1).forEach(dupe => {
      if (alreadyMarked.has(dupe.__rowNumber)) return;

      sheet.getRange(dupe.__rowNumber, statusCol).setValue('Duplicate');

      if (notesCol > 0) {
        sheet.getRange(dupe.__rowNumber, notesCol).setValue(
          appendNote(
            dupe['Review Notes'],
            'Dedupe agent marked duplicate of row ' + keeper.__rowNumber +
            '. Match based on normalized URL/title/employer similarity.'
          )
        );
      }

      alreadyMarked.add(dupe.__rowNumber);
      duplicatesMarked++;
    });
  });

  return { duplicatesMarked: duplicatesMarked, groupsReviewed: groupsReviewed };
}

function archiveOldJobs() {
  const result = runArchiveOldJobsCore();
  safeAlert('Archive complete.\n\nJobs archived: ' + result.archived);
}

function runArchiveOldJobsCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Jobs');

  if (!sheet) throw new Error('No Jobs sheet found.');

  ensureJobHeaders(sheet);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return { archived: 0 };

  const headers = data[0].map(h => String(h).trim());
  const statusCol = headers.indexOf('Status') + 1;
  const notesCol = headers.indexOf('Review Notes') + 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let archived = 0;

  data.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const job = {};
    headers.forEach((header, i) => job[header] = row[i]);

    const status = String(job['Status'] || '').trim().toLowerCase();
    if (status === 'duplicate' || status === 'rejected' || status === 'expired' || status === 'archived') return;

    const postedDate = new Date(job['Posted Date']);
    if (isNaN(postedDate)) return;

    postedDate.setHours(0, 0, 0, 0);
    const ageDays = Math.floor((today - postedDate) / (1000 * 60 * 60 * 24));

    if (ageDays > 30) {
      sheet.getRange(rowNumber, statusCol).setValue('Expired');
      if (notesCol > 0) {
        sheet.getRange(rowNumber, notesCol).setValue(
          appendNote(job['Review Notes'], 'Auto-archived because Posted Date is more than 30 days old.')
        );
      }
      archived++;
    }
  });

  return { archived: archived };
}

function sendWeeklyDigest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName('Jobs');
  const subscribersSheet = ss.getSheetByName('Subscribers');

  if (!jobsSheet) throw new Error('No Jobs sheet found.');
  if (!subscribersSheet) throw new Error('No Subscribers sheet found.');

  const jobsData = jobsSheet.getDataRange().getDisplayValues();
  const subsData = subscribersSheet.getDataRange().getDisplayValues();

  if (jobsData.length < 2 || subsData.length < 2) {
    safeAlert('No jobs or subscribers available for digest.');
    return;
  }

  const jobHeaders = jobsData[0].map(h => String(h).trim());
  const subHeaders = subsData[0].map(h => String(h).trim());

  const emailCol = subHeaders.indexOf('Email');
  const statusCol = subHeaders.indexOf('Status');

  const subscribers = subsData.slice(1)
    .filter(row => String(row[statusCol] || '').trim().toLowerCase() === 'active')
    .map(row => String(row[emailCol] || '').trim())
    .filter(email => email && email.includes('@'));

  const jobs = jobsData.slice(1).map(row => {
    const job = {};
    jobHeaders.forEach((header, i) => job[header] = row[i]);
    return job;
  }).filter(job => {
    const status = String(job['Status'] || '').trim().toLowerCase();
    if (status !== 'active') return false;

    const added = new Date(job['Date Added']);
    if (isNaN(added)) return false;

    const ageDays = Math.floor((new Date() - added) / (1000 * 60 * 60 * 24));
    return ageDays <= 7;
  }).sort((a, b) => new Date(b['Date Added']) - new Date(a['Date Added']));

  if (jobs.length === 0) {
    safeAlert('No active jobs added in the last 7 days. Digest not sent.');
    return;
  }

  const subject = 'New prospect research jobs this week';
  const plainBody = buildDigestPlainText(jobs);
  const htmlBody = buildDigestHtml(jobs);

  subscribers.forEach(email => {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      replyTo: 'info@prospectresearchjobs.com',
      name: 'Prospect Research Jobs'
    });
  });

  safeAlert('Weekly digest sent to ' + subscribers.length + ' subscriber(s).');
}

function buildDigestPlainText(jobs) {
  let body = 'New prospect research jobs this week\n\n';

  jobs.slice(0, 25).forEach(job => {
    body += '• ' + (job['Job Title'] || 'Untitled Job') + ' — ' + (job['Employer'] || 'Unknown employer') + '\n';
    body += '  ' + (job['Location'] || 'Location not listed') + ' · ' + (job['Work Mode'] || 'Unknown') + '\n';
    body += '  ' + (job['Apply URL'] || job['Source URL'] || '') + '\n\n';
  });

  body += 'ProspectResearchJobs.com\n';
  body += 'Questions or job submissions: info@prospectresearchjobs.com\n';

  return body;
}

function buildDigestHtml(jobs) {
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#252A2E;">';
  html += '<h2>New prospect research jobs this week</h2>';

  jobs.slice(0, 25).forEach(job => {
    const url = escapeHtml(job['Apply URL'] || job['Source URL'] || '#');
    html += '<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #DDD6C8;">';
    html += '<strong><a href="' + url + '" style="color:#2F5D7C;">' + escapeHtml(job['Job Title'] || 'Untitled Job') + '</a></strong><br>';
    html += escapeHtml(job['Employer'] || 'Unknown employer') + ' · ' + escapeHtml(job['Location'] || 'Location not listed') + ' · ' + escapeHtml(job['Work Mode'] || 'Unknown') + '<br>';
    html += '<span style="color:#667275;">' + escapeHtml(job['Summary'] || '') + '</span>';
    html += '</div>';
  });

  html += '<p style="color:#667275;font-size:12px;">ProspectResearchJobs.com · Questions or job submissions: info@prospectresearchjobs.com</p>';
  html += '</div>';

  return html;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCompanyName(value) {
  let text = String(value || '').toLowerCase().trim();

  if (isMissingField(text)) return '';

  return text
    .replace(/&/g, ' and ')
    .replace(/\b(the|university|college|foundation|inc|llc|corp|corporation|school|office|department|dept)\b/g, ' ')
    .replace(/\bof\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDedupeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(senior|sr|associate|assistant|the|job|posting|apply|now|full time|part time|remote|hybrid|onsite|on site)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDedupeUrl(url) {
  let value = String(url || '').trim().toLowerCase();
  if (!value) return '';

  value = value.replace(/^https?:\/\/www\./, 'https://');
  value = value.split('#')[0];
  value = value.split('?')[0];
  value = value.replace(/\/$/, '');

  return value;
}

function scoreJobCompleteness(job) {
  const fields = [
    'Job Title',
    'Employer',
    'Location',
    'Work Mode',
    'Salary Range',
    'Posted Date',
    'Apply URL',
    'Summary',
    'Tags'
  ];

  let score = 0;
  fields.forEach(field => {
    if (!isMissingField(job[field])) score++;
  });

  return score;
}

function statusPriority(status) {
  const value = String(status || '').trim().toLowerCase();

  if (value === 'active') return 5;
  if (value === 'needs review') return 4;
  if (value === 'rejected') return 3;
  if (value === 'duplicate') return 2;
  if (value === 'expired') return 1;

  return 0;
}

function textSimilarity(a, b) {
  const setA = new Set(String(a || '').split(/\s+/).filter(Boolean));
  const setB = new Set(String(b || '').split(/\s+/).filter(Boolean));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach(value => {
    if (setB.has(value)) intersection++;
  });

  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

const REVIEW_RESUME_PROP = 'REVIEW_RESUME_ROW';

function autoReviewPendingJobs() {
  const result = runReviewCore();

  if (result.totalRows === 0) {
    safeAlert('No jobs to review.');
    return;
  }

  if (result.finished) {
    safeAlert(
      'Auto-review complete.\n\n' +
      'Approved: ' + result.approved + '\n' +
      'Kept for review: ' + result.keptForReview + '\n' +
      'Rejected: ' + result.rejected
    );
  } else {
    safeAlert(
      'Auto-review paused before finishing all rows (time limit). So far — approved: ' + result.approved +
      ', kept for review: ' + result.keptForReview + ', rejected: ' + result.rejected + '.\n\n' +
      'Run "Auto-Review Pending Jobs" again to continue where it left off, or let the daily automation handle it.'
    );
  }
}

// Same resumable, time-budgeted pattern as runImportCore / runEnrichCore.
// This is the step that lets postings reach "Active" with minimal human
// involvement: it approves high-confidence matches, rejects clear junk, and
// leaves genuinely ambiguous rows as "Needs human review" for you to check.
function runReviewCore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Jobs');

  if (!sheet) throw new Error('No Jobs sheet found.');

  ensureJobHeaders(sheet);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) {
    return { finished: true, approved: 0, keptForReview: 0, rejected: 0, totalRows: 0 };
  }

  const headers = data[0].map(h => String(h).trim());

  const statusCol = headers.indexOf('Status') + 1;
  const notesCol = headers.indexOf('Review Notes') + 1;

  const props = PropertiesService.getScriptProperties();
  const resumeRaw = props.getProperty(REVIEW_RESUME_PROP);
  const startRowNumber = resumeRaw ? Number(resumeRaw) : 2;

  const startTime = Date.now();
  let approved = 0;
  let keptForReview = 0;
  let rejected = 0;
  let finished = true;

  for (let rowNumber = startRowNumber; rowNumber <= data.length; rowNumber++) {
    const row = data[rowNumber - 1];
    const job = {};

    headers.forEach((header, i) => {
      job[header] = row[i];
    });

    const status = String(job['Status'] || '').trim().toLowerCase();

    if (status === 'needs review') {
      let review = null;

      try {
        review = reviewPendingJobWithAI(job);
      } catch (error) {
        sheet.getRange(rowNumber, notesCol).setValue('AI review failed: ' + error.message);
        keptForReview++;
      }

      if (review) {
        const confidence = Number(review.confidence_score || 0);
        const decision = String(review.decision || '').toLowerCase();
        const note = review.review_note || '';

        if (decision === 'approve' && confidence >= 85) {
          sheet.getRange(rowNumber, statusCol).setValue('Active');
          sheet.getRange(rowNumber, notesCol).setValue('AI approved · confidence ' + confidence + ' · ' + note);
          approved++;
        } else if (decision === 'reject' && confidence >= 90) {
          sheet.getRange(rowNumber, statusCol).setValue('Rejected');
          sheet.getRange(rowNumber, notesCol).setValue('AI rejected · confidence ' + confidence + ' · ' + note);
          rejected++;
        } else {
          sheet.getRange(rowNumber, notesCol).setValue('Needs human review · confidence ' + confidence + ' · ' + note);
          keptForReview++;
        }
      }
    }

    if (Date.now() - startTime > STAGE_TIME_BUDGET_MS && rowNumber < data.length) {
      props.setProperty(REVIEW_RESUME_PROP, String(rowNumber + 1));
      finished = false;
      break;
    }
  }

  if (finished) {
    props.deleteProperty(REVIEW_RESUME_PROP);
  }

  return { finished, approved, keptForReview, rejected, totalRows: data.length - 1 };
}

function reviewPendingJobWithAI(job) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in Script Properties.');

  const payload = {
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a conservative editor for ProspectResearchJobs.com. ' +
          'Approve only if the row is clearly a real job posting related to prospect research, prospect development, prospect management, advancement analytics, fundraising analytics, development research, donor research, relationship intelligence, or advancement data strategy. ' +
          'Reject only if clearly irrelevant or junk. Otherwise choose needs_review. ' +
          'Do not approve rows with missing employer, missing apply URL, obvious navigation text, or vague/non-job titles.'
      },
      {
        role: 'user',
        content:
          'Review this job row:\n\n' +
          JSON.stringify(job, null, 2)
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'job_publish_review',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            decision: {
              type: 'string',
              enum: ['approve', 'needs_review', 'reject']
            },
            confidence_score: {
              type: 'number'
            },
            review_note: {
              type: 'string'
            }
          },
          required: [
            'decision',
            'confidence_score',
            'review_note'
          ]
        }
      }
    },
    temperature: 0
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status >= 400) {
    throw new Error('OpenAI API error ' + status + ': ' + body.substring(0, 500));
  }

  const parsed = JSON.parse(body);
  return JSON.parse(parsed.choices[0].message.content);
}

function getJobSources() {
  return [
    { name: 'APRA Career Center', url: 'https://apra.careerwebsite.com/jobs/' },
    { name: 'APRA Main Career Center', url: 'https://www.aprahome.org/CareerCenter' },
    { name: 'APRA Canada', url: 'https://apracanada.ca/job-postings' },
    { name: 'APRA Northwest', url: 'https://www.apra-nw.org/Jobs?emulatemode=1' },
    { name: 'APRA Carolinas', url: 'https://apracarolinas.wildapricot.org/Jobs?emulatemode=1' },
    { name: 'APRA Minnesota', url: 'https://apra-mn.org/jobs?emulatemode=1' },
    { name: 'APRA Georgia', url: 'https://apraga.wildapricot.org/Jobs' },
    { name: 'CARA', url: 'http://caresearchers.org/classifieds.php', parser: 'cara' },
    { name: 'CASE Career Central', url: 'https://careers.case.org/jobs/function/Prospect/' },
    { name: 'Philanthropy Jobs - Prospect Research', url: 'https://jobs.philanthropy.com/jobs/prospect-research/' },
    { name: 'HigherEdJobs - Prospect Research', url: 'https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=prospect%20research' },
    { name: 'HigherEdJobs - Prospect Development', url: 'https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=prospect%20development' },
    { name: 'HigherEdJobs - Advancement Analytics', url: 'https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=advancement%20analytics' },
    { name: 'AHP Career Center', url: 'https://ahp-jobs.careerwebsite.com/jobs/' }
  ];
}

// --------------------------------------------------------------------------
// FIXED: CARA parser now extracts title + link from the SAME html fragment
// instead of building two separate lists (page-text titles, anchor links)
// and pairing them up by array index. The old approach could easily pair
// job #3's title with job #5's link (or an unrelated fallback link) whenever
// the two lists didn't line up 1:1, which is very common on classifieds pages.
// --------------------------------------------------------------------------
function extractCARAJobs(html, source) {
  const jobs = [];

  const cleanHtml = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  // Try to split the page into listing-sized fragments so each title stays
  // paired with its own link. Fall back through a few common container tags.
  let fragments = splitIntoFragments(cleanHtml, 'tr');
  if (fragments.length < 2) fragments = splitIntoFragments(cleanHtml, 'li');
  if (fragments.length < 2) fragments = splitIntoFragments(cleanHtml, 'p');
  if (fragments.length < 2) fragments = splitIntoFragments(cleanHtml, 'div');

  fragments.forEach(fragment => {
    const linkMatch = fragment.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) return;

    const applyUrl = normalizeUrl(decodeEntities(linkMatch[1].trim()), source.url);
    const fragmentText = htmlToText(fragment);

    if (!fragmentText || fragmentText.length < 8) return;

    const lower = fragmentText.toLowerCase();
    const isRelevant =
      lower.includes('prospect') ||
      lower.includes('research analyst') ||
      lower.includes('relationship intelligence') ||
      lower.includes('advancement analytics') ||
      lower.includes('development research');

    if (!isRelevant) return;

    const title = cleanPossibleTitle(fragmentText.substring(0, 160));
    if (!title) return;

    jobs.push({
      title: title,
      employer: 'Review needed',
      location: 'Review needed',
      workMode: inferWorkMode(fragmentText),
      salary: 'Review needed',
      postedDate: new Date(),
      source: source.name,
      sourceUrl: source.url,
      applyUrl: applyUrl,
      summary: 'Imported from CARA classifieds. Review original posting before marking Active.',
      tags: inferTags(fragmentText)
    });
  });

  return dedupeJobs(jobs).slice(0, 20);
}

// Splits raw HTML into fragments on the opening tag of the given tag name,
// keeping each fragment self-contained enough that a title and its link
// found inside it are actually the same listing.
function splitIntoFragments(html, tagName) {
  const pattern = new RegExp('<' + tagName + '[\\s>]', 'gi');
  const parts = html.split(pattern);
  if (parts.length < 2) return [];
  return parts.slice(1).map(part => '<' + tagName + ' ' + part);
}

function extractJobsFromHtml(html, source) {
  const jobs = [];
  const links = extractLinks(html, source.url);

  links.forEach(link => {
    const title = cleanPossibleTitle(link.text);
    const applyUrl = link.url;

    if (!title) return;
    if (!isPossibleJobLink(title, applyUrl)) return;

    jobs.push({
      title: title,
      employer: 'Review needed',
      location: 'Review needed',
      workMode: inferWorkMode(title),
      salary: 'Review needed',
      postedDate: new Date(),
      source: source.name,
      sourceUrl: source.url,
      applyUrl: applyUrl,
      summary: 'Imported from ' + source.name + '. AI cleanup pending.',
      tags: inferTags(title)
    });
  });

  return dedupeJobs(jobs).slice(0, 25);
}

function extractLinks(html, baseUrl) {
  const cleanHtml = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const matches = [...cleanHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  return matches.map(match => {
    return {
      url: normalizeUrl(match[1], baseUrl),
      text: stripHtml(match[2]).replace(/\s+/g, ' ').trim()
    };
  }).filter(link => link.url && link.text);
}

function buildFinalJob(candidate, cleaned, detailText, source) {
  if (cleaned) {
    return {
      title: cleaned.title || candidate.title,
      employer: cleaned.employer || 'Not listed',
      location: cleaned.location || 'Not listed',
      workMode: cleaned.work_mode || inferWorkMode(detailText + ' ' + candidate.title),
      salary: cleaned.salary || 'Not listed',
      postedDate: cleaned.posted_date || candidate.postedDate || new Date(),
      source: source.name,
      sourceUrl: source.url,
      applyUrl: candidate.applyUrl,
      summary: cleaned.summary || 'Review original posting before marking Active.',
      tags: cleaned.tags || inferTags(candidate.title + ' ' + detailText)
    };
  }

  return {
    title: candidate.title,
    employer: 'Review needed',
    location: inferLocationFallback(detailText),
    workMode: inferWorkMode(detailText + ' ' + candidate.title),
    salary: inferSalaryFallback(detailText),
    postedDate: candidate.postedDate || new Date(),
    source: source.name,
    sourceUrl: source.url,
    applyUrl: candidate.applyUrl,
    summary: 'AI cleanup failed or was unavailable. Review the original posting before marking Active.',
    tags: inferTags(candidate.title + ' ' + detailText)
  };
}

// --------------------------------------------------------------------------
// FIXED: previously, whenever cleanJobWithAI() failed (rate limit, timeout,
// bad JSON, etc.), this function required an EXACT phrase match from
// strongTerms before importing anything. Lots of legitimately relevant
// postings ("Prospect Researcher," "Senior Analyst, Advancement Services")
// don't contain any of those exact phrases and were silently rejected.
// Added a looser keyword fallback that only kicks in when AI cleanup failed,
// so a temporary AI outage doesn't quietly reject good postings.
// --------------------------------------------------------------------------
function shouldImportJob(candidate, cleaned, detailText) {
  const combined = String(candidate.title + ' ' + detailText).toLowerCase();

  const strongTerms = [
    'prospect research',
    'prospect development',
    'prospect management',
    'advancement analytics',
    'fundraising analytics',
    'development research',
    'donor research',
    'relationship intelligence'
  ];

  if (strongTerms.some(term => combined.includes(term))) return true;
  if (cleaned && cleaned.is_relevant && Number(cleaned.relevance_score || 0) >= 35) return true;

  if (!cleaned) {
    const looseTerms = [
      'prospect',
      'advancement',
      'donor research',
      'research analyst',
      'relationship intelligence',
      'wealth screening',
      'gift officer research'
    ];
    const titleLower = String(candidate.title || '').toLowerCase();
    if (looseTerms.some(term => titleLower.includes(term))) return true;
  }

  return false;
}

function cleanJobWithAI(candidate, detailText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in Script Properties.');

  const clippedText = String(detailText || '').substring(0, 12000);

  const payload = {
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content:
          'You clean messy job posting text into strict JSON for a prospect research job board. ' +
          'Only mark is_relevant true if the role is related to prospect research, prospect development, prospect management, advancement analytics, fundraising analytics, development research, donor research, relationship intelligence, or advancement data strategy. ' +
          'Do not invent missing information. Use "Not listed" when unknown. Keep summary to 1-2 sentences.'
      },
      {
        role: 'user',
        content:
          'Source: ' + candidate.source + '\n' +
          'Candidate title: ' + candidate.title + '\n' +
          'Candidate URL: ' + candidate.applyUrl + '\n\n' +
          'Job page text:\n' + clippedText
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'job_cleanup',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            is_relevant: { type: 'boolean' },
            relevance_score: { type: 'number' },
            title: { type: 'string' },
            employer: { type: 'string' },
            location: { type: 'string' },
            work_mode: { type: 'string', enum: ['Remote', 'Hybrid', 'Onsite', 'Unknown'] },
            salary: { type: 'string' },
            posted_date: { type: 'string' },
            summary: { type: 'string' },
            tags: { type: 'string' }
          },
          required: [
            'is_relevant',
            'relevance_score',
            'title',
            'employer',
            'location',
            'work_mode',
            'salary',
            'posted_date',
            'summary',
            'tags'
          ]
        }
      }
    },
    temperature: 0
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status >= 400) {
    throw new Error('OpenAI API error ' + status + ': ' + body.substring(0, 500));
  }

  const parsed = JSON.parse(body);
  return JSON.parse(parsed.choices[0].message.content);
}

function fetchUrl(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const status = response.getResponseCode();

  if (status >= 400) throw new Error('HTTP ' + status + ' for ' + url);

  return response.getContentText();
}

function isPossibleJobLink(title, url) {
  const text = String(title + ' ' + url).toLowerCase();

  const includeTerms = [
    'prospect',
    'advancement',
    'fundraising',
    'development',
    'donor',
    'research',
    'analytics',
    'analyst',
    'manager',
    'director',
    'relationship intelligence',
    'job',
    'career',
    'position'
  ];

  const excludeTerms = [
    'privacy',
    'terms',
    'login',
    'sign in',
    'subscribe',
    'employer',
    'post a job',
    'job seeker',
    'resume',
    'register',
    'membership',
    'event',
    'conference',
    'webinar',
    'sponsor',
    'contact',
    'about',
    'board',
    'committee',
    'newsletter'
  ];

  if (excludeTerms.some(term => text.includes(term))) return false;
  return includeTerms.some(term => text.includes(term));
}

function inferWorkMode(text) {
  const lower = String(text).toLowerCase();

  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('onsite') || lower.includes('on-site')) return 'Onsite';

  return 'Unknown';
}

function inferLocationFallback(text) {
  const clean = String(text).replace(/\s+/g, ' ');
  const match = clean.match(/\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b/);
  return match ? match[0] : 'Review needed';
}

function inferSalaryFallback(text) {
  const clean = String(text).replace(/\s+/g, ' ');
  const match = clean.match(/\$\s?\d{2,3},?\d{3}\s?[-–—to]+\s?\$?\s?\d{2,3},?\d{3}/i);
  return match ? match[0] : 'Not listed';
}

function inferTags(text) {
  const lower = String(text).toLowerCase();
  const tags = [];

  if (lower.includes('analytics')) tags.push('analytics');
  if (lower.includes('prospect research')) tags.push('prospect research');
  if (lower.includes('prospect development')) tags.push('prospect development');
  if (lower.includes('prospect management')) tags.push('prospect management');
  if (lower.includes('fundraising')) tags.push('fundraising');
  if (lower.includes('relationship intelligence')) tags.push('relationship intelligence');
  if (lower.includes('director')) tags.push('director');
  if (lower.includes('manager')) tags.push('manager');
  if (lower.includes('senior')) tags.push('senior');
  if (lower.includes('remote')) tags.push('remote');
  if (lower.includes('hybrid')) tags.push('hybrid');

  return [...new Set(tags)].join(', ');
}

// --------------------------------------------------------------------------
// FIXED: previously used `new URL(baseUrl)` to get the origin for
// root-relative links. The URL constructor's availability inside the Apps
// Script V8 runtime is inconsistent, and any failure here threw an error
// that bubbled all the way up past the per-candidate try/catch blocks and
// got caught by the outer per-source catch — meaning a single bad link
// could make an entire source's import silently fail with a generic
// "SOURCE FAILED" log entry. Now uses a regex to pull the origin instead,
// with a protocol-relative (`//host/path`) case handled too.
// --------------------------------------------------------------------------
function normalizeUrl(url, baseUrl) {
  if (!url) return baseUrl;

  url = String(url).trim();

  if (/^https?:\/\//i.test(url)) return url;

  const originMatch = String(baseUrl).match(/^https?:\/\/[^\/]+/i);
  const origin = originMatch ? originMatch[0] : baseUrl;

  if (url.startsWith('//')) {
    const schemeMatch = String(baseUrl).match(/^https?:/i);
    return (schemeMatch ? schemeMatch[0] : 'https:') + url;
  }

  if (url.startsWith('/')) return origin + url;

  if (String(baseUrl).endsWith('/')) return baseUrl + url;
  return baseUrl + '/' + url;
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPossibleTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—|•\s]+/, '')
    .replace(/[-–—|•\s]+$/, '')
    .replace(/Learn More/gi, '')
    .replace(/Apply Now/gi, '')
    .replace(/Job Posting/gi, '')
    .trim()
    .substring(0, 160);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function dedupeJobs(jobs) {
  const seen = new Set();

  return jobs.filter(job => {
    const key = makeJobKey(job);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeJobKey(job) {
  return [
    String(job.title || job['Job Title'] || '').toLowerCase().trim(),
    String(job.applyUrl || job['Apply URL'] || '').toLowerCase().trim()
  ].join('|');
}

function getExistingJobKeys(sheet) {
  const data = sheet.getDataRange().getDisplayValues();

  if (data.length < 2) return new Set();

  const headers = data[0].map(h => String(h).trim());
  const titleIndex = headers.indexOf('Job Title');
  const applyIndex = headers.indexOf('Apply URL');

  const keys = new Set();

  data.slice(1).forEach(row => {
    const title = titleIndex >= 0 ? row[titleIndex] : '';
    const applyUrl = applyIndex >= 0 ? row[applyIndex] : '';

    keys.add([
      String(title || '').toLowerCase().trim(),
      String(applyUrl || '').toLowerCase().trim()
    ].join('|'));
  });

  return keys;
}

function ensureJobHeaders(sheet) {
  const requiredHeaders = [
    'Status',
    'Job Title',
    'Employer',
    'Location',
    'Work Mode',
    'Salary Range',
    'Posted Date',
    'Date Added',
    'Source',
    'Source URL',
    'Apply URL',
    'Summary',
    'Tags',
    'Review Notes'
  ];

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];

  if (currentHeaders.every(cell => String(cell).trim() === '')) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }

  requiredHeaders.forEach(header => {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    if (!existingHeaders.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function getOrCreateImportLogSheet(ss) {
  let sheet = ss.getSheetByName('Import Log');
  if (!sheet) sheet = ss.insertSheet('Import Log');
  return sheet;
}

function resetImportLog(sheet) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 5).setValues([[
    'Timestamp',
    'Source',
    'URL',
    'Status',
    'Details'
  ]]);
}

function logImport(sheet, source, url, status, details) {
  sheet.appendRow([
    new Date(),
    source,
    url,
    status,
    details
  ]);
}

function testOpenAIKey() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    SpreadsheetApp.getUi().alert('Missing OPENAI_API_KEY in Script Properties.');
    return;
  }

  const payload = {
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'Return only this JSON: {"status":"ok"}' }],
    temperature: 0
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  SpreadsheetApp.getUi().alert(
    'OpenAI test response code: ' + response.getResponseCode() + '\n\n' +
    response.getContentText().substring(0, 500)
  );
}

function debugJobs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet Name: ' + ss.getName());
  Logger.log('Spreadsheet URL: ' + ss.getUrl());

  ss.getSheets().forEach(sheet => Logger.log('Sheet: ' + sheet.getName()));

  const jobsSheet = ss.getSheetByName('Jobs');

  if (!jobsSheet) {
    Logger.log('ERROR: Jobs sheet not found.');
    return;
  }

  const data = jobsSheet.getDataRange().getDisplayValues();
  Logger.log(JSON.stringify(data, null, 2));
}
