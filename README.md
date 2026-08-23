# Prospect Research Jobs

Public GitHub Pages front end for [ProspectResearchJobs.com](https://prospectresearchjobs.com/), backed by the existing Google Sheets and Apps Script review pipeline.

## Publication rules

- Only `Active` jobs are eligible.
- Jobs older than 30 days are omitted.
- Title, employer, source, and a valid application URL are required.
- Placeholder/test rows and `example.com` application links are rejected.
- Duplicate application URLs are collapsed.
- Missing optional information is shown as `Not listed`; it is never invented.
- A large unexpected drop in listing count fails safely and preserves the previous snapshot.

## Automatic updates

The GitHub Actions workflow runs every four hours and on demand. The approved-job feed URL is already configured in the workflow.

The Apps Script deployment must be updated with `apps-script/Code.gs`, deployed as the script owner, and made accessible to **Anyone**. Editing the existing deployment preserves its URL.

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
