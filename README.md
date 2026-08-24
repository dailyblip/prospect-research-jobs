# Prospect Research Jobs

Public GitHub Pages front end for [ProspectResearchJobs.com](https://prospectresearchjobs.com/), with a GitHub-native job collector and deployment workflow.

## Publication rules

- Only `Active` jobs are eligible.
- Jobs older than 30 days are omitted.
- Title, employer, source, and a valid application URL are required.
- Placeholder/test rows and `example.com` application links are rejected.
- Duplicate application URLs are collapsed.
- Missing optional information is shown as `Not listed`; it is never invented.
- A large unexpected drop in listing count fails safely and preserves the previous snapshot.

## Automatic updates

The GitHub Actions workflow runs once daily and on demand. It searches selected public APRA chapter boards, advancement career centers, and higher-education/philanthropy job boards; follows job-detail pages; and publishes only complete, current listings.

No Google Apps Script, connector, secret, or manual refresh is required for job collection. Confirmed closed pages and postings over 30 days old are removed. Temporary source failures preserve the last verified snapshot, and unchanged runs do not create commits.

The legacy Apps Script importer remains available as `npm run sync:feed`, but it is not used by the scheduled workflow.

## Weekly email alerts

The signup form posts to the existing Google Apps Script web app. Subscriber addresses stay in the spreadsheet's `Subscribers` tab, while each Monday's digest reads current listings from `https://prospectresearchjobs.com/data/jobs.json`.

To activate or update the alerts:

1. Open the spreadsheet's bound Apps Script project and replace `Code.gs` with `apps-script/Code.gs` from this repository.
2. Save, select `setupWeeklyDigest`, click **Run**, and approve the requested spreadsheet, external-request, and email permissions.
3. Open **Deploy → Manage deployments**, edit the existing web app, choose **New version**, set **Execute as** to yourself and **Who has access** to **Anyone**, then deploy.

`setupWeeklyDigest` is safe to run again: it removes duplicate digest triggers and creates one Monday trigger at approximately 8:00 AM in the Apps Script project time zone. Delivery is protected against duplicate sends, respects the Apps Script daily email quota, and adds a private unsubscribe link to every message.

## GitHub Pages

In repository settings:

1. Open **Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the `Sync jobs and deploy Pages` workflow.

## Custom domain

In **Settings → Pages**, enter `prospectresearchjobs.com` as the custom domain. Then, at the domain's DNS provider, replace the existing website records with GitHub Pages records:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `dailyblip.github.io` |

After DNS validates, enable **Enforce HTTPS** in GitHub Pages settings.

## Local checks

```bash
node --test
node scripts/validate-site.mjs
node scripts/build-site.mjs
```
