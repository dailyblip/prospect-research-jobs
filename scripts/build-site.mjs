import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist');
const paths = [
  'index.html',
  'about.html',
  'privacy.html',
  '404.html',
  'CNAME',
  'robots.txt',
  'sitemap.xml',
  'assets',
  'data'
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of paths) {
  await cp(path.join(root, entry), path.join(destination, entry), { recursive: true });
}
console.log(`Built static site at ${destination}`);
