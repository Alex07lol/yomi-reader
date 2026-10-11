/* ─── Service-worker offline bridge ───
   The reader can read a saved book offline through IndexedDB alone. This bridge
   additionally asks the service worker to keep the underlying chapter JSON and
   cover responses in Cache Storage, so a reload while offline is served at the
   network layer too. Every call no-ops safely when no worker controls the page
   (for example in development). */

import type { Novel } from '../models';

export interface OfflineCacheResult {
  ok: boolean;
  cached: number;
}

const MESSAGE_TIMEOUT_MS = 15_000;

function activeWorker(): ServiceWorker | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.controller ?? null;
}

export function serviceWorkerAvailable(): boolean {
  return activeWorker() !== null;
}

function requestServiceWorker<T>(message: Record<string, unknown>, fallback: T): Promise<T> {
  const worker = activeWorker();
  if (!worker) return Promise.resolve(fallback);

  return new Promise<T>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(fallback), MESSAGE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(fallback);
    }
  });
}

/** Absolute URL of a shared novel's chapter data file. */
export function chapterDataUrl(novelId: string): string {
  return new URL(`data/chapters/${encodeURIComponent(novelId)}.json`, document.baseURI).href;
}

/** Same-origin absolute URLs a saved shared book needs to be fully offline. */
export function offlineResourceUrls(novel: Pick<Novel, 'id' | 'cover'>): string[] {
  const urls = [chapterDataUrl(novel.id)];
  if (novel.cover && !/^(?:data:|blob:|https?:)/i.test(novel.cover)) {
    urls.push(new URL(novel.cover, document.baseURI).href);
  }
  return urls;
}

export async function precacheOfflineNovel(novelId: string, urls: string[]): Promise<OfflineCacheResult> {
  if (urls.length === 0) return { ok: true, cached: 0 };
  return requestServiceWorker<OfflineCacheResult>(
    { type: 'yomi-cache-offline', novelId, urls },
    { ok: false, cached: 0 },
  );
}

export async function removeOfflineNovelCache(novelId: string): Promise<boolean> {
  const result = await requestServiceWorker<{ ok: boolean }>(
    { type: 'yomi-remove-offline', novelId },
    { ok: false },
  );
  return result.ok;
}
