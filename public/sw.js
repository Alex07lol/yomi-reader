/* Yomi's worker caches only the public app shell and shared catalog metadata. */
const CACHE_PREFIX = 'yomi-shell:';
const CACHE_SCHEMA = 'v1';
const BUILD_ID = '__YOMI_BUILD_ID__';
const ACTIVE_POINTER_CACHE = `${CACHE_PREFIX}active`;
const PENDING_POINTER_CACHE = `${CACHE_PREFIX}pending`;
const POINTER_PATH = '/__yomi_cache_pointer__';
const OFFLINE_URL = '/offline.html';
const MANIFEST_URL = '/manifest.webmanifest';
const ICON_URLS = ['/favicon.svg', '/icons.svg'];
const NOVELS_URL = '/data/novels.json';
/* Explicitly saved books keep their chapter JSON and covers in a cache that is
   independent of the versioned app shell, so an app-shell update never drops
   downloaded reading. */
const OFFLINE_CACHE = 'yomi-offline:v1';
const CHAPTERS_PATH = '/data/chapters/';
const COVERS_PATH = '/covers/';
const MAX_OFFLINE_RESOURCE_BYTES = 8_000_000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_SCRIPT_BYTES = 20_000_000;
const MAX_STYLE_BYTES = 5_000_000;
const MAX_ICON_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 64_000;
const MAX_CATALOG_BYTES = 2_000_000;

function safeHeaders(headers) {
  const cleaned = new Headers(headers);
  cleaned.delete('content-encoding');
  cleaned.delete('content-length');
  cleaned.delete('content-range');
  return cleaned;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function writeCachePointer(pointerCacheName, targetCacheName) {
  const cache = await caches.open(pointerCacheName);
  const pointerUrl = new URL(POINTER_PATH, self.location.origin).href;
  await cache.put(pointerUrl, new Response(targetCacheName, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }));
}

async function readCachePointer(pointerCacheName) {
  const cache = await caches.open(pointerCacheName);
  const pointer = await cache.match(new URL(POINTER_PATH, self.location.origin).href);
  return pointer ? (await pointer.text()).trim() : null;
}

function readAttributes(tag) {
  const attributes = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function extractBuildAssets(html, origin) {
  const assets = new Map();
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const source = readAttributes(match[0]).src;
    if (source) assets.set(source, 'script');
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const rel = (attributes.rel || '').toLowerCase().split(/\s+/);
    if (attributes.href && rel.includes('stylesheet')) {
      assets.set(attributes.href, 'style');
    }
    if (attributes.href && rel.includes('modulepreload')) {
      assets.set(attributes.href, 'script');
    }
  }

  const resolved = [];
  for (const [source, kind] of assets) {
    const url = new URL(source, origin);
    const hashedBuildPath = /^\/assets\/.+[.-][\w-]{8,}\.(?:js|mjs|css)$/i.test(url.pathname);
    const expectedExtension = kind === 'script' ? /\.(?:js|mjs)$/i : /\.css$/i;
    if (url.origin !== origin || !hashedBuildPath || !expectedExtension.test(url.pathname) || url.pathname.startsWith('/src/')) {
      throw new Error('The built app shell contains an unexpected entry asset.');
    }
    resolved.push({ url: url.href, kind });
  }

  if (!resolved.some(asset => asset.kind === 'script')) {
    throw new Error('The built app shell has no production JavaScript entry.');
  }
  return resolved.sort((left, right) => left.url.localeCompare(right.url));
}

async function fetchChecked(url, { mime, maxBytes, acceptJson = false } = {}) {
  const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
  if (!response.ok || response.type !== 'basic' || response.status !== 200) {
    throw new Error(`Required app-shell resource was unavailable: ${url}`);
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (mime && !contentType.includes(mime) && !(acceptJson && contentType.includes('application/json'))) {
    throw new Error(`Required app-shell resource had an unexpected type: ${url}`);
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error(`Required app-shell resource was too large: ${url}`);
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error(`Required app-shell resource was too large: ${url}`);
  if (acceptJson) JSON.parse(new TextDecoder().decode(body));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: safeHeaders(response.headers) });
}

async function fetchHtml(url, maxBytes) {
  const response = await fetchChecked(url, { mime: 'text/html', maxBytes });
  return { response, html: await response.clone().text() };
}

async function installShell() {
  const origin = self.location.origin;
  const rootUrl = new URL('/', origin).href;
  const { response: rootResponse, html } = await fetchHtml(rootUrl, MAX_HTML_BYTES);
  const buildAssets = extractBuildAssets(html, origin);
  const required = [
    { url: rootUrl, mime: 'text/html', maxBytes: MAX_HTML_BYTES, response: rootResponse },
    { url: new URL(OFFLINE_URL, origin).href, mime: 'text/html', maxBytes: MAX_HTML_BYTES },
    { url: new URL(MANIFEST_URL, origin).href, mime: 'json', maxBytes: MAX_MANIFEST_BYTES, acceptJson: true },
    ...ICON_URLS.map(path => ({ url: new URL(path, origin).href, mime: 'image/svg+xml', maxBytes: MAX_ICON_BYTES })),
    ...buildAssets.map(asset => ({
      url: asset.url,
      mime: asset.kind === 'script' ? 'javascript' : 'text/css',
      maxBytes: asset.kind === 'script' ? MAX_SCRIPT_BYTES : MAX_STYLE_BYTES,
    })),
    { url: new URL(NOVELS_URL, origin).href, mime: 'json', maxBytes: MAX_CATALOG_BYTES, acceptJson: true },
  ];

  // Fetch and validate the complete shell before touching Cache Storage. This
  // keeps an interrupted update from replacing a previously usable shell.
  const resources = await Promise.all(required.map(async resource => ({
    ...resource,
    response: resource.response || await fetchChecked(resource.url, resource),
  })));
  const signatures = await Promise.all(resources.map(async resource => {
    const body = await resource.response.clone().arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', body);
    return `${resource.url}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }));
  const version = `${CACHE_SCHEMA}-${BUILD_ID}-${(await sha256(signatures.join('\n'))).slice(0, 24)}`;
  const cacheName = `${CACHE_PREFIX}${version}`;
  const existingNames = await caches.keys();
  if (existingNames.includes(cacheName)) {
    self.__yomiCacheName = cacheName;
    return;
  }

  const cache = await caches.open(cacheName);
  try {
    for (const resource of resources) {
      await cache.put(resource.url, resource.response);
    }
    await writeCachePointer(PENDING_POINTER_CACHE, cacheName);
    self.__yomiCacheName = cacheName;
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(installShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const currentName = self.__yomiCacheName
      || await readCachePointer(PENDING_POINTER_CACHE)
      || await readCachePointer(ACTIVE_POINTER_CACHE);
    if (!currentName) return;
    self.__yomiCacheName = currentName;
    await writeCachePointer(ACTIVE_POINTER_CACHE, currentName);
    await caches.delete(PENDING_POINTER_CACHE);
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX)
        && name !== currentName
        && name !== ACTIVE_POINTER_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function currentShellCacheName() {
  // During installation the name is derived from the same emitted entry paths.
  // Store that name in the worker global when the install completes, or recover
  // it from the single active cache in fetch handlers.
  return self.__yomiCacheName || null;
}

async function shellCache() {
  const knownName = currentShellCacheName() || await readCachePointer(ACTIVE_POINTER_CACHE);
  if (knownName) return caches.open(knownName);
  return null;
}

function isHashedBuildAsset(url) {
  return url.origin === self.location.origin
    && /^\/assets\/.+[.-][\w-]{8,}\.(?:js|mjs|css)$/i.test(url.pathname);
}

async function cachedShellResponse(request) {
  const cache = await shellCache();
  if (!cache) return null;
  return cache.match(request, { ignoreSearch: false });
}

async function networkFirstCatalog(request) {
  try {
    const response = await fetch(request);
    const type = (response.headers.get('content-type') || '').toLowerCase();
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (response.ok && response.status === 200 && type.includes('json') && declaredLength <= MAX_CATALOG_BYTES) {
      const body = await response.arrayBuffer();
      if (body.byteLength <= MAX_CATALOG_BYTES) {
        JSON.parse(new TextDecoder().decode(body));
        const safeResponse = new Response(body, { status: response.status, statusText: response.statusText, headers: safeHeaders(response.headers) });
        const cache = await shellCache();
        if (cache) await cache.put(request, safeResponse.clone());
        return safeResponse;
      }
    }
    const fallback = await cachedShellResponse(request);
    return fallback || response;
  } catch {
    return (await cachedShellResponse(request)) || Response.error();
  }
}

async function navigationFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch {
    // Continue to the cached app shell and then the small offline explanation.
  }

  const cache = await shellCache();
  if (cache && new URL(request.url).pathname === '/') {
    const appShell = await cache.match(new URL('/', self.location.origin).href);
    if (appShell) return appShell;
  }
  if (cache) {
    const fallback = await cache.match(new URL(OFFLINE_URL, self.location.origin).href);
    if (fallback) return fallback;
  }
  return new Response('Yomi is offline. Reconnect and try again.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function isOfflineResource(url) {
  return url.origin === self.location.origin
    && (url.pathname.startsWith(CHAPTERS_PATH) || url.pathname.startsWith(COVERS_PATH));
}

/* Chapters are network-first so shared text can update; covers are read from the
   cache first because they rarely change. Only explicitly saved books populate
   `yomi-offline:` (through the message API below), so browsing online never grows
   this cache on its own; both paths fall back to it when the network is unavailable. */
async function offlineResource(request, preferCache) {
  const cache = await caches.open(OFFLINE_CACHE);
  if (preferCache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  try {
    return await fetch(request);
  } catch {
    return (await cache.match(request)) || (await cachedShellResponse(request)) || Response.error();
  }
}

async function cacheOfflineNovel(urls) {
  const cache = await caches.open(OFFLINE_CACHE);
  let cached = 0;
  for (const raw of urls) {
    try {
      const url = new URL(raw, self.location.origin);
      if (!isOfflineResource(url)) continue;
      const response = await fetch(url.href, { cache: 'reload', credentials: 'same-origin' });
      if (!response.ok || response.status !== 200) continue;
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_OFFLINE_RESOURCE_BYTES) continue;
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_OFFLINE_RESOURCE_BYTES) continue;
      await cache.put(url.href, new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: safeHeaders(response.headers),
      }));
      cached += 1;
    } catch {
      // A single unavailable resource must not fail the whole download.
    }
  }
  return cached;
}

async function removeOfflineNovel(novelId) {
  if (!novelId) return false;
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  const needle = encodeURIComponent(novelId);
  let removed = false;
  for (const request of keys) {
    if (request.url.includes(needle)) {
      await cache.delete(request);
      removed = true;
    }
  }
  return removed;
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  const replyPort = event.ports && event.ports[0];
  const reply = value => { if (replyPort) replyPort.postMessage(value); };

  if (data.type === 'yomi-cache-offline' && Array.isArray(data.urls)) {
    event.waitUntil(cacheOfflineNovel(data.urls).then(cached => reply({ ok: true, cached })));
    return;
  }
  if (data.type === 'yomi-remove-offline') {
    event.waitUntil(removeOfflineNovel(data.novelId).then(ok => reply({ ok })));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }
  if (url.pathname === NOVELS_URL) {
    event.respondWith(networkFirstCatalog(request));
    return;
  }
  if ([MANIFEST_URL, OFFLINE_URL, ...ICON_URLS].includes(url.pathname)) {
    event.respondWith((async () => (await cachedShellResponse(request)) || fetch(request))());
    return;
  }
  if (isOfflineResource(url)) {
    event.respondWith(offlineResource(request, url.pathname.startsWith(COVERS_PATH)));
    return;
  }
  if (isHashedBuildAsset(url)) {
    event.respondWith((async () => (await cachedShellResponse(request)) || fetch(request))());
  }
});
