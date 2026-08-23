import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'index.html',
  'about.html',
  'privacy.html',
  '404.html',
  'CNAME',
  'robots.txt',
  'sitemap.xml',
  'assets/styles.css',
  'assets/app.js',
  'data/jobs.json'
];

for (const file of requiredFiles) await access(path.join(root, file));

const [html, appJavaScript, jobsText, cname] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'assets/app.js'), 'utf8'),
  readFile(path.join(root, 'data/jobs.json'), 'utf8'),
  readFile(path.join(root, 'CNAME'), 'utf8')
]);

for (const requiredText of ['assets/styles.css', 'assets/app.js', 'Prospect Research Jobs']) {
  if (!html.includes(requiredText)) throw new Error(`index.html is missing ${requiredText}`);
}
if (!appJavaScript.includes('data/jobs.json')) throw new Error('assets/app.js is missing the jobs data path.');

const snapshot = JSON.parse(jobsText);
if (!Array.isArray(snapshot.jobs)) throw new Error('data/jobs.json must contain a jobs array.');
if (snapshot.count !== snapshot.jobs.length) throw new Error('Job count does not match jobs array length.');
if (cname.trim() !== 'prospectresearchjobs.com') throw new Error('CNAME must be prospectresearchjobs.com.');

console.log(`Validated site with ${snapshot.count} published jobs.`);
