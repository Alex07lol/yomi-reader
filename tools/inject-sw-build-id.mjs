import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(projectRoot, 'dist');
const indexPath = path.join(outputRoot, 'index.html');
const workerPath = path.join(outputRoot, 'sw.js');
const indexHtml = await readFile(indexPath, 'utf8');

function attributes(tag) {
  const found = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return found;
}

const publicPaths = new Set([
  '/manifest.webmanifest',
  '/offline.html',
  '/favicon.svg',
  '/icons.svg',
  '/data/novels.json',
]);

for (const match of indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  const attr = attributes(match[0]);
  if (match[0].startsWith('<script') && attr.src) publicPaths.add(attr.src);
  if (match[0].startsWith('<link')) {
    const rel = (attr.rel || '').toLowerCase().split(/\s+/);
    if (attr.href && (rel.includes('stylesheet') || rel.includes('modulepreload'))) publicPaths.add(attr.href);
  }
}

const buildFiles = [];
buildFiles.push({ path: '/index.html', digest: createHash('sha256').update(indexHtml).digest('hex') });
for (const publicPath of [...publicPaths].sort()) {
  const parsed = new URL(publicPath, 'https://yomi.invalid');
  if (parsed.origin !== 'https://yomi.invalid' || parsed.search || parsed.hash) {
    throw new Error(`Unexpected public build path in index.html: ${publicPath}`);
  }
  const relativePath = parsed.pathname.replace(/^\//, '');
  const absolutePath = path.resolve(outputRoot, relativePath);
  if (!absolutePath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error(`Build path escaped dist: ${publicPath}`);
  }
  const contents = await readFile(absolutePath);
  buildFiles.push({ path: parsed.pathname, digest: createHash('sha256').update(contents).digest('hex') });
}

// One nonce per production invocation ensures even a byte-identical rebuild
// produces a fresh worker; the content digest keeps the ID tied to this output.
const buildId = createHash('sha256')
  .update(JSON.stringify(buildFiles))
  .update(randomUUID())
  .digest('hex')
  .slice(0, 24);
let worker = await readFile(workerPath, 'utf8');
const marker = "const BUILD_ID = '__YOMI_BUILD_ID__';";
if (!worker.includes(marker) || worker.indexOf(marker) !== worker.lastIndexOf(marker)) {
  throw new Error('The built service worker must contain exactly one Yomi build ID marker.');
}
worker = worker.replace(marker, `const BUILD_ID = '${buildId}';`);
await writeFile(workerPath, worker, 'utf8');
console.log(`Injected Yomi production build ID ${buildId} into dist/sw.js`);
