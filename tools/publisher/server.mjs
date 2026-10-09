import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishCatalogEntry, readCatalog, validatePublication } from './catalog.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, '../..');
const publisherDist = path.join(directory, 'dist');
const stageRoot = path.join(directory, '.staging');
const configPath = path.join(directory, 'publisher.config.json');
const PORT = Number(process.env.YOMI_PUBLISHER_PORT || 4173);
const HOST = '127.0.0.1';
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const STAGE_TTL_MS = 30 * 60 * 1000;
const allowedPorts = new Set([4173, 4174, 5173, 5174, 4175]);
const staged = new Map();
let lastBuildSucceeded = false;

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
]);

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  response.end(body);
}

function localAddress(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function parseLocalUrl(value, label) {
  let url;
  try { url = new URL(value.includes('://') ? value : `http://${value}`); }
  catch { throw new Error(`A valid local ${label} is required.`); }
  if (url.protocol !== 'http:' || !localAddress(url.hostname)) throw new Error(`Only loopback ${label} values are accepted.`);
  const port = url.port ? Number(url.port) : 80;
  if (!allowedPorts.has(port)) throw new Error(`The ${label} uses an unapproved local port.`);
  return url;
}

function assertLocalRequest(request) {
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== 'string') throw new Error('A loopback Host header is required.');
  parseLocalUrl(hostHeader, 'Host');
  const origin = request.headers.origin;
  if (origin) {
    const originUrl = parseLocalUrl(origin, 'Origin');
    const hostUrl = parseLocalUrl(hostHeader, 'Host');
    // localhost and 127.0.0.1 are accepted aliases only for the same local service.
    const sameLocalHost = originUrl.hostname === hostUrl.hostname ||
      (localAddress(originUrl.hostname) && localAddress(hostUrl.hostname) &&
       !['[::1]', '::1'].includes(originUrl.hostname) && !['[::1]', '::1'].includes(hostUrl.hostname));
    const expectedPort = originUrl.port ? Number(originUrl.port) : 80;
    const requestPort = hostUrl.port ? Number(hostUrl.port) : 80;
    if (!sameLocalHost || expectedPort !== requestPort) throw new Error('Cross-origin requests are not accepted by the local publisher.');
  }
}

async function readBody(request, limit) {
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(String(contentLength))) throw new Error('Invalid Content-Length.');
    if (Number(contentLength) > limit) throw new Error(`Request is too large. Limit: ${Math.floor(limit / (1024 * 1024))} MiB.`);
  }
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > limit) throw new Error(`Request is too large. Limit: ${Math.floor(limit / (1024 * 1024))} MiB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function requireContentType(request, expected) {
  const actual = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (!expected.includes(actual)) throw new Error(`Use ${expected.join(' or ')} for this request.`);
}

async function readJson(request, limit = MAX_JSON_BYTES) {
  requireContentType(request, ['application/json']);
  const bytes = await readBody(request, limit);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Request body must be valid UTF-8 JSON.'); }
}

function cleanExpiredStages() {
  const now = Date.now();
  for (const [token, entry] of staged) {
    if (entry.expiresAt > now) continue;
    staged.delete(token);
    rm(entry.filePath, { force: true }).catch(() => {});
  }
}

function getStage(token, kind) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/i.test(token)) throw new Error('The staged file token is invalid. Choose the file again.');
  const entry = staged.get(token);
  if (!entry || entry.expiresAt <= Date.now()) throw new Error('The staged file expired. Choose the file again and retry.');
  if (entry.kind !== kind) throw new Error(`The staged token is not a ${kind} file.`);
  return entry;
}

async function stageUpload(request, kind) {
  const types = kind === 'epub'
    ? ['application/epub+zip', 'application/octet-stream']
    : ['image/png', 'image/jpeg', 'image/webp'];
  requireContentType(request, types);
  const bytes = await readBody(request, MAX_ASSET_BYTES);
  if (!bytes.length) throw new Error('The selected file is empty.');
  if (kind === 'epub' && (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error('The selected book does not look like a ZIP-based EPUB file.');
  const token = randomUUID();
  await mkdir(stageRoot, { recursive: true });
  const filePath = path.join(stageRoot, `${token}.${kind}`);
  // This path is generated by the server and never comes from request data.
  await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  const entry = { filePath, kind, size: bytes.byteLength, expiresAt: Date.now() + STAGE_TTL_MS };
  staged.set(token, entry);
  return { token, size: entry.size, expiresInSeconds: STAGE_TTL_MS / 1000 };
}

function configData() {
  return readFile(configPath, 'utf8').then(text => {
    const config = JSON.parse(text);
    const projectName = config.projectName ?? config.pagesProjectName;
    if (!validProjectName(projectName)) throw new Error('Project name must use letters, numbers, and hyphens.');
    const previewBranch = config.previewBranch ?? 'preview';
    if (!validProjectName(previewBranch)) throw new Error('Preview branch must use letters, numbers, and hyphens.');
    return { configured: true, projectName, previewBranch };
  }).catch(error => {
    if (error?.code === 'ENOENT') return { configured: false, message: 'Add tools/publisher/publisher.config.json with your Cloudflare Pages project name. See the example file.' };
    throw error;
  });
}

function validProjectName(value) {
  return typeof value === 'string' && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function npmCliPath() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function runFixedNode(args, { timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, shell: false, windowsHide: true, env: process.env });
    let output = '';
    const append = (chunk, prefix) => {
      output = `${output}${prefix}${chunk.toString('utf8')}`.slice(-120_000);
    };
    child.stdout.on('data', chunk => append(chunk, ''));
    child.stderr.on('data', chunk => append(chunk, '\n'));
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} timed out.\n${output}`)); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(new Error(`${label} could not start: ${error.message}\n${output}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${label} failed with exit code ${code}.\n${output}`));
      else resolve(output.trim());
    });
  });
}

async function servePublisherFile(requestPath, response) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); }
  catch { return json(response, 400, { error: 'Invalid URL path.' }); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const normalized = path.normalize(relative);
  if (normalized.startsWith('..') || path.isAbsolute(normalized) || normalized.includes(`..${path.sep}`)) return json(response, 404, { error: 'Publisher page not found.' });
  const allowed = normalized === 'index.html' || normalized.startsWith(`assets${path.sep}`);
  if (!allowed) return json(response, 404, { error: 'Publisher page not found.' });
  const target = path.join(publisherDist, normalized);
  const distReal = await realpath(publisherDist).catch(() => null);
  if (!distReal) return json(response, 503, { error: 'Build the local publisher first with npm run publisher:build, then restart it.' });
  const relativeToDist = path.relative(distReal, target);
  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) return json(response, 404, { error: 'Publisher page not found.' });
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) return json(response, 404, { error: 'Publisher page not found.' });
    const actualTarget = await realpath(target);
    const actualRelative = path.relative(distReal, actualTarget);
    if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) return json(response, 404, { error: 'Publisher page not found.' });
    const body = await readFile(actualTarget);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    response.end(body);
  } catch { json(response, 404, { error: 'Publisher page not found.' }); }
}

async function handler(request, response) {
  try { assertLocalRequest(request); }
  catch (error) { return json(response, 403, { error: error.message }); }
  const method = request.method || 'GET';
  const pathname = new URL(request.url || '/', `http://${HOST}:${PORT}`).pathname;
  try {
    if (method === 'GET' && pathname === '/api/catalog') return json(response, 200, { novels: await readCatalog(projectRoot) });
    if (method === 'GET' && pathname === '/api/config') return json(response, 200, await configData());
    if (method === 'POST' && pathname === '/api/stage/epub') return json(response, 201, await stageUpload(request, 'epub'));
    if (method === 'POST' && pathname === '/api/stage/cover') return json(response, 201, await stageUpload(request, 'cover'));
    if (method === 'POST' && pathname === '/api/publish') {
      const payload = await readJson(request);
      const epubStage = getStage(payload.epubToken, 'epub'); const coverStage = getStage(payload.coverToken, 'cover');
      const [epubBytes, coverBytes] = await Promise.all([readFile(epubStage.filePath), readFile(coverStage.filePath)]);
      await validatePublication({ id: payload.novel?.id, novel: payload.novel, chapters: payload.chapters, epubBytes, coverBytes, root: projectRoot });
      await publishCatalogEntry({ root: projectRoot, novel: payload.novel, chapters: payload.chapters, epubBytes, coverBytes });
      staged.delete(payload.epubToken); staged.delete(payload.coverToken);
      await Promise.all([rm(epubStage.filePath, { force: true }), rm(coverStage.filePath, { force: true })]);
      const id = payload.novel.id; const coverExtension = coverBytes[0] === 0x89 ? 'png' : coverBytes[0] === 0xff ? 'jpg' : 'webp';
      return json(response, 201, { paths: [`public/covers/${id}.${coverExtension}`, `public/epubs/${id}.epub`, `public/data/chapters/${id}.json`, 'public/data/novels.json'] });
    }
    if (method === 'POST' && pathname === '/api/build') {
      await readJson(request, 1024 * 1024);
      const cli = npmCliPath();
      if (!cli) throw new Error('Cannot locate npm’s local script runner. Open a terminal in the project and try again.');
      lastBuildSucceeded = false;
      const output = await runFixedNode([cli, 'run', 'build'], { timeoutMs: 10 * 60 * 1000, label: 'Public site build' });
      lastBuildSucceeded = true;
      return json(response, 200, { output });
    }
    if (method === 'POST' && pathname === '/api/deploy') {
      const payload = await readJson(request, 1024 * 1024);
      if (!lastBuildSucceeded) throw new Error('Build the site successfully before deploying. The last failed build cannot be deployed.');
      if (!['preview', 'production'].includes(payload.environment)) throw new Error('Choose preview or production deployment.');
      if (payload.environment === 'production' && payload.confirmation !== 'DEPLOY') throw new Error('Production deployment requires the explicit DEPLOY confirmation.');
      const config = await configData();
      if (!config.configured) throw new Error(config.message);
      const wranglerPath = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
      await stat(wranglerPath).catch(() => { throw new Error('Wrangler is not installed in this project yet. Install the project dependencies and retry.'); });
      const args = [wranglerPath, 'pages', 'deploy', path.join(projectRoot, 'dist'), '--project-name', config.projectName];
      if (payload.environment === 'preview') args.push('--branch', config.previewBranch);
      const output = await runFixedNode(args, { timeoutMs: 15 * 60 * 1000, label: `${payload.environment} deployment` });
      return json(response, 200, { output });
    }
    if (method === 'GET' && !pathname.startsWith('/api/')) return servePublisherFile(pathname, response);
    return json(response, 404, { error: 'Publisher endpoint not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request could not be completed.';
    return json(response, 400, { error: message });
  }
}

await mkdir(stageRoot, { recursive: true, mode: 0o700 });
const stageRootInfo = await lstat(stageRoot);
if (!stageRootInfo.isDirectory() || stageRootInfo.isSymbolicLink()) {
  throw new Error('The private staging folder must be a regular directory inside tools/publisher.');
}
// Staged files from a previous process cannot be referenced because tokens are in-memory.
for (const name of await readdir(stageRoot).catch(() => [])) {
  if (/^[a-f0-9-]{36}\.(?:epub|cover)$/i.test(name)) await rm(path.join(stageRoot, name), { force: true }).catch(() => {});
}
setInterval(cleanExpiredStages, 60_000).unref();
const server = createServer(handler);
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`Yomi Publisher is available at http://${HOST}:${PORT}`));

function stop() {
  server.close(() => process.exit(0));
  for (const entry of staged.values()) rm(entry.filePath, { force: true }).catch(() => {});
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
