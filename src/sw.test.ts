// @vitest-environment node
/*
 * Hard test for the real service worker source (`public/sw.js`).
 *
 * The worker is executed in a simulated `ServiceWorkerGlobalScope` built on
 * Node's `vm`, with a controllable Cache Storage and a controllable network, so
 * every offline path can be exercised deterministically:
 *   install -> shell cache, navigation fallback, chapter/cover network-first
 *   with cache fallback, the precache/evict message API, and the catalog cache.
 *
 * This runs the actual shipped file rather than a copy, so a regression in
 * `sw.js` fails the suite.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// The real shipped worker source, inlined by Vite so the suite always runs the
// file that is actually deployed.
import swSource from '../public/sw.js?raw';

const ORIGIN = 'https://yomi.test';

/* ── Minimal, well-typed Response / Headers / Request for the sandbox ── */

class FakeHeaders {
  private values = new Map<string, string>();
  constructor(init?: FakeHeaders | Record<string, string> | null) {
    if (init instanceof FakeHeaders) {
      init.forEach((value, key) => this.values.set(key.toLowerCase(), value));
    } else if (init) {
      for (const [key, value] of Object.entries(init)) this.values.set(key.toLowerCase(), String(value));
    }
  }
  get(name: string): string | null { return this.values.get(name.toLowerCase()) ?? null; }
  set(name: string, value: string): void { this.values.set(name.toLowerCase(), String(value)); }
  has(name: string): boolean { return this.values.has(name.toLowerCase()); }
  delete(name: string): void { this.values.delete(name.toLowerCase()); }
  forEach(callback: (value: string, key: string) => void): void { this.values.forEach((value, key) => callback(value, key)); }
}

class FakeResponse {
  readonly bodyBytes: Uint8Array;
  readonly headers: FakeHeaders;
  readonly status: number;
  readonly statusText: string;
  readonly type: string;
  readonly url: string;
  constructor(body: string | Uint8Array | ArrayBuffer | null = null, init: { status?: number; statusText?: string; headers?: FakeHeaders | Record<string, string>; type?: string } = {}) {
    if (typeof body === 'string') this.bodyBytes = new TextEncoder().encode(body);
    else if (body instanceof Uint8Array) this.bodyBytes = body;
    else if (body instanceof ArrayBuffer) this.bodyBytes = new Uint8Array(body);
    else this.bodyBytes = new Uint8Array(0);
    this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers ?? null);
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.type = init.type ?? 'basic';
    this.url = '';
  }
  get ok(): boolean { return this.status >= 200 && this.status < 300; }
  clone(): FakeResponse {
    const copy = new FakeResponse(this.bodyBytes.slice(), { status: this.status, statusText: this.statusText, type: this.type });
    copy.headers.forEach((value, key) => copy.headers.set(key, value));
    return copy;
  }
  arrayBuffer(): ArrayBuffer { return this.bodyBytes.slice().buffer; }
  text(): string { return new TextDecoder().decode(this.bodyBytes); }
  static error(): FakeResponse { return new FakeResponse(null, { status: 0, statusText: '', type: 'error' }); }
}

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: FakeHeaders;
  constructor(input: string | FakeRequest, init: { method?: string; mode?: string; headers?: FakeHeaders | Record<string, string> } = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = init.method ?? (typeof input === 'string' ? 'GET' : input.method);
    this.mode = init.mode ?? (typeof input === 'string' ? 'no-cors' : input.mode);
    this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers ?? null);
  }
}

/* ── Cache Storage ── */

function requestUrl(input: string | FakeRequest | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, ORIGIN).href;
}

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();
  async put(input: string | FakeRequest, response: FakeResponse): Promise<void> {
    this.entries.set(requestUrl(input), response.clone());
  }
  async match(input: string | FakeRequest): Promise<FakeResponse | undefined> {
    return this.entries.get(requestUrl(input))?.clone();
  }
  async keys(): Promise<FakeRequest[]> {
    return [...this.entries.keys()].map((url) => new FakeRequest(url));
  }
  async delete(input: string | FakeRequest): Promise<boolean> {
    return this.entries.delete(requestUrl(input));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) { cache = new FakeCache(); this.caches.set(name, cache); }
    return cache;
  }
  async keys(): Promise<string[]> { return [...this.caches.keys()]; }
  async delete(name: string): Promise<boolean> { return this.caches.delete(name); }
  async match(input: string | FakeRequest): Promise<FakeResponse | undefined> {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(input);
      if (hit) return hit;
    }
    return undefined;
  }
  async has(name: string): Promise<boolean> { return this.caches.has(name); }
}

/* ── The harness ── */

interface SwEvent {
  request?: FakeRequest;
  data?: unknown;
  ports?: Array<{ postMessage: (value: unknown) => void }>;
  respondWith?: (value: Promise<FakeResponse>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface Sandbox {
  storage: FakeCacheStorage;
  resources: Map<string, { body: string; contentType: string; status?: number }>;
  setOnline(value: boolean): void;
  dispatchLifecycle(type: 'install' | 'activate'): Promise<void>;
  dispatchFetch(url: string, init?: { method?: string; mode?: string }): Promise<{ intercepted: boolean; response?: FakeResponse }>;
  dispatchMessage(data: unknown): Promise<{ replies: unknown[]; intercepted: boolean }>;
}

function buildSandbox(): Sandbox {
  const storage = new FakeCacheStorage();
  const resources = new Map<string, { body: string; contentType: string; status?: number }>();
  let online = true;
  const listeners = new Map<string, Array<(event: SwEvent) => void>>();

  const fetchImpl = async (input: string | FakeRequest): Promise<FakeResponse> => {
    if (!online) throw new TypeError('fetch failed (simulated offline)');
    const url = new URL(requestUrl(input), ORIGIN);
    if (url.origin !== ORIGIN) throw new TypeError('fetch failed (cross-origin)');
    const resource = resources.get(url.pathname + url.search);
    if (!resource) return new FakeResponse('not found', { status: 404, statusText: 'Not Found', type: 'basic' });
    return new FakeResponse(resource.body, {
      status: resource.status ?? 200,
      statusText: 'OK',
      type: 'basic',
      headers: { 'content-type': resource.contentType, 'content-length': String(new TextEncoder().encode(resource.body).byteLength) },
    });
  };

  const addEventListener = (type: string, handler: (event: SwEvent) => void): void => {
    const list = listeners.get(type) ?? [];
    list.push(handler);
    listeners.set(type, list);
  };

  const scope: Record<string, unknown> = {
    addEventListener,
    clients: { claim: async () => undefined },
    location: { origin: ORIGIN },
  };
  scope.self = scope;

  // Evaluate the real worker source with the simulated globals supplied as
  // parameters, so its bare `fetch`, `caches`, `Response`, … references resolve
  // to this harness instead of the host environment.
  const evaluate = new Function(
    'self', 'caches', 'fetch', 'Response', 'Headers', 'Request',
    'URL', 'TextEncoder', 'TextDecoder', 'crypto', 'console',
    swSource,
  ) as (...globals: unknown[]) => void;
  evaluate(
    scope, storage, fetchImpl, FakeResponse, FakeHeaders, FakeRequest,
    URL, TextEncoder, TextDecoder, globalThis.crypto, console,
  );


  async function dispatchLifecycle(type: 'install' | 'activate'): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const handler of listeners.get(type) ?? []) handler({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  async function dispatchFetch(url: string, init: { method?: string; mode?: string } = {}) {
    let responder: (() => Promise<FakeResponse>) | null = null;
    const pending: Promise<unknown>[] = [];
    const request = new FakeRequest(url, { method: init.method ?? 'GET', mode: init.mode ?? 'cors' });
    for (const handler of listeners.get('fetch') ?? []) {
      handler({ request, respondWith: (value: Promise<FakeResponse>) => { responder = () => value; }, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    }
    if (!responder) return { intercepted: false };
    const response = await (responder as () => Promise<FakeResponse>)();
    await Promise.all(pending);
    return { intercepted: true, response };
  }

  async function dispatchMessage(data: unknown) {
    const replies: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const port = { postMessage: (value: unknown) => replies.push(value) };
    for (const handler of listeners.get('message') ?? []) {
      handler({ data, ports: [port], waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    }
    await Promise.all(pending);
    return { replies, intercepted: true };
  }

  return {
    storage,
    resources,
    setOnline: (value: boolean) => { online = value; },
    dispatchLifecycle,
    dispatchFetch,
    dispatchMessage,
  };
}

const SHELL_HTML = `
<!doctype html><html><head>
  <link rel="stylesheet" href="/assets/index-abc12345.css" />
  <script type="module" src="/assets/index-abc12345.js"></script>
</head><body><div id="app"></div></body></html>`;

const CHAPTER_BODY = JSON.stringify([{ id: 'novel-1-ch-1', novelId: 'novel-1', title: 'One', content: '<p>hi</p>' }]);

function seedResources(sandbox: Sandbox, novelId = 'novel-1'): void {
  sandbox.resources.set('/', { body: SHELL_HTML, contentType: 'text/html; charset=utf-8' });
  sandbox.resources.set('/offline.html', { body: '<html>offline</html>', contentType: 'text/html' });
  sandbox.resources.set('/manifest.webmanifest', { body: '{"name":"Yomi"}', contentType: 'application/manifest+json' });
  sandbox.resources.set('/favicon.svg', { body: '<svg/>', contentType: 'image/svg+xml' });
  sandbox.resources.set('/icons.svg', { body: '<svg/>', contentType: 'image/svg+xml' });
  sandbox.resources.set('/data/novels.json', { body: '[{"id":"novel-1"}]', contentType: 'application/json' });
  sandbox.resources.set('/assets/index-abc12345.js', { body: 'export default {}', contentType: 'text/javascript' });
  sandbox.resources.set('/assets/index-abc12345.css', { body: '.a{}', contentType: 'text/css' });
  sandbox.resources.set(`/data/chapters/${novelId}.json`, { body: CHAPTER_BODY, contentType: 'application/json' });
  sandbox.resources.set('/covers/novel-1.jpg', { body: 'jpg-bytes', contentType: 'image/jpeg' });
  sandbox.resources.set('/covers/novel-2.jpg', { body: 'other-cover', contentType: 'image/jpeg' });
}

function shellCache(sandbox: Sandbox): FakeCache {
  const name = [...sandbox.storage.caches.keys()].find((entry) => entry.startsWith('yomi-shell:') && entry !== 'yomi-shell:active' && entry !== 'yomi-shell:pending');
  if (!name) throw new Error('no shell cache was created');
  return sandbox.storage.caches.get(name)!;
}

async function bootedSandbox(): Promise<Sandbox> {
  const sandbox = buildSandbox();
  seedResources(sandbox);
  await sandbox.dispatchLifecycle('install');
  await sandbox.dispatchLifecycle('activate');
  return sandbox;
}

describe('service worker install', () => {
    let sandbox: Sandbox;

    beforeAll(async () => {
      sandbox = await bootedSandbox();
    });

    it('caches the complete app shell plus the shared catalog', () => {
      const cache = shellCache(sandbox);
      const urls = [...cache.entries.keys()];
      expect(urls).toContain(`${ORIGIN}/`);
      expect(urls).toContain(`${ORIGIN}/offline.html`);
      expect(urls).toContain(`${ORIGIN}/manifest.webmanifest`);
      expect(urls).toContain(`${ORIGIN}/data/novels.json`);
      expect(urls).toContain(`${ORIGIN}/assets/index-abc12345.js`);
      expect(urls).toContain(`${ORIGIN}/assets/index-abc12345.css`);
      expect(urls).toContain(`${ORIGIN}/favicon.svg`);
      expect(urls).toContain(`${ORIGIN}/icons.svg`);
    });

    it('marks the shell active when activation completes', () => {
      expect(sandbox.storage.caches.has('yomi-shell:active')).toBe(true);
      expect(sandbox.storage.caches.has('yomi-shell:pending')).toBe(false);
    });

    it('retains an explicitly-downloaded offline cache across an app-shell update', async () => {
      await sandbox.dispatchMessage({ type: 'yomi-cache-offline', novelId: 'novel-1', urls: [`${ORIGIN}/data/chapters/novel-1.json`] });
      expect(sandbox.storage.caches.has('yomi-offline:v1')).toBe(true);

      await sandbox.dispatchLifecycle('install');
      await sandbox.dispatchLifecycle('activate');
      expect(sandbox.storage.caches.has('yomi-offline:v1')).toBe(true);
    });
});

describe('service worker runtime caching', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await bootedSandbox();
  });

  it('passes chapter requests through to the network while online', async () => {
    const result = await sandbox.dispatchFetch(`${ORIGIN}/data/chapters/novel-1.json`);
    expect(result.intercepted).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(result.response?.text()).toBe(CHAPTER_BODY);
  });

  it('serves the app shell for an offline navigation to the root', async () => {
    sandbox.setOnline(false);
    const result = await sandbox.dispatchFetch(`${ORIGIN}/`, { mode: 'navigate' });
    expect(result.response?.status).toBe(200);
    expect(result.response?.text()).toContain('id="app"');
  });

  it('serves the app shell for an offline hash deep link (so the reader can open)', async () => {
    sandbox.setOnline(false);
    const result = await sandbox.dispatchFetch(`${ORIGIN}/#reader/novel-1/novel-1-ch-1`, { mode: 'navigate' });
    expect(result.response?.status).toBe(200);
    expect(result.response?.text()).toContain('id="app"');
  });

  it('serves the offline page for an offline navigation to an uncached real path', async () => {
    sandbox.setOnline(false);
    const result = await sandbox.dispatchFetch(`${ORIGIN}/library/deep/unpublished/path`, { mode: 'navigate' });
    expect(result.response?.text()).toContain('offline');
  });

  it('falls back to the cached catalog offline', async () => {
    sandbox.setOnline(false);
    const result = await sandbox.dispatchFetch(`${ORIGIN}/data/novels.json`);
    expect(result.response?.status).toBe(200);
    expect(result.response?.text()).toBe('[{"id":"novel-1"}]');
  });

  it('serves an offline hashed asset from the shell cache', async () => {
    sandbox.setOnline(false);
    const result = await sandbox.dispatchFetch(`${ORIGIN}/assets/index-abc12345.js`);
    expect(result.response?.status).toBe(200);
    expect(result.response?.text()).toBe('export default {}');
  });

  it('ignores cross-origin and non-GET requests', async () => {
    expect((await sandbox.dispatchFetch('https://example.com/data.json')).intercepted).toBe(false);
    expect((await sandbox.dispatchFetch(`${ORIGIN}/data/novels.json`, { method: 'POST' })).intercepted).toBe(false);
  });
});

describe('offline downloads (precache message)', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await bootedSandbox();
  });

  it('precaches a chapter file and its cover, reporting the count', async () => {
    const result = await sandbox.dispatchMessage({
      type: 'yomi-cache-offline',
      novelId: 'novel-1',
      urls: [`${ORIGIN}/data/chapters/novel-1.json`, `${ORIGIN}/covers/novel-1.jpg`],
    });
    expect(result.replies).toEqual([{ ok: true, cached: 2 }]);

    sandbox.setOnline(false);
    const chapter = await sandbox.dispatchFetch(`${ORIGIN}/data/chapters/novel-1.json`);
    expect(chapter.response?.status).toBe(200);
    expect(chapter.response?.text()).toBe(CHAPTER_BODY);

    const cover = await sandbox.dispatchFetch(`${ORIGIN}/covers/novel-1.jpg`);
    expect(cover.response?.status).toBe(200);
    expect(cover.response?.text()).toBe('jpg-bytes');
  });

  it('refuses to cache URLs outside the chapter and cover paths', async () => {
    const result = await sandbox.dispatchMessage({
      type: 'yomi-cache-offline',
      novelId: 'novel-1',
      urls: [
        `${ORIGIN}/data/novels.json`,
        `${ORIGIN}/index.html`,
        'https://evil.test/data/chapters/novel-1.json',
      ],
    });
    expect(result.replies).toEqual([{ ok: true, cached: 0 }]);
    const offline = await sandbox.storage.open('yomi-offline:v1');
    expect(offline.entries.size).toBe(0);
  });

  it('reports a partial count when one resource is missing', async () => {
    const result = await sandbox.dispatchMessage({
      type: 'yomi-cache-offline',
      novelId: 'novel-1',
      urls: [`${ORIGIN}/covers/novel-1.jpg`, `${ORIGIN}/covers/missing.jpg`],
    });
    expect(result.replies).toEqual([{ ok: true, cached: 1 }]);
  });

  it('evicts only the removed novel and leaves other downloads intact', async () => {
    await sandbox.dispatchMessage({
      type: 'yomi-cache-offline',
      novelId: 'novel-1',
      urls: [`${ORIGIN}/data/chapters/novel-1.json`, `${ORIGIN}/covers/novel-1.jpg`],
    });
    seedResources(sandbox, 'novel-2');
    await sandbox.dispatchMessage({
      type: 'yomi-cache-offline',
      novelId: 'novel-2',
      urls: [`${ORIGIN}/data/chapters/novel-2.json`, `${ORIGIN}/covers/novel-2.jpg`],
    });

    const removed = await sandbox.dispatchMessage({ type: 'yomi-remove-offline', novelId: 'novel-1' });
    expect(removed.replies).toEqual([{ ok: true }]);

    const cache = await sandbox.storage.open('yomi-offline:v1');
    const keys = [...cache.entries.keys()];
    expect(keys.some((key) => key.includes('novel-1'))).toBe(false);
    expect(keys.some((key) => key.includes('novel-2'))).toBe(true);

    sandbox.setOnline(false);
    expect((await sandbox.dispatchFetch(`${ORIGIN}/data/chapters/novel-2.json`)).response?.status).toBe(200);
  });

  it('ignores unrelated messages', async () => {
    const result = await sandbox.dispatchMessage({ type: 'something-else' });
    expect(result.replies).toEqual([]);
  });
});
