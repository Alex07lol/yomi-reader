/*
 * Online/offline behaviour of the reader's data layer.
 *
 * `src/data` decides, for every read, whether to use the network, a personal
 * EPUB import, or the copy saved for offline reading. These tests drive that
 * precedence with a controllable network and controllable IndexedDB stores, so
 * the "reader works offline" promise is verified rather than assumed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, Novel } from '../models';

const h = vi.hoisted(() => ({
  importedNovel: null as Novel | null | undefined,
  importedChapters: [] as Chapter[],
  importedThrows: false,
  savedNovel: null as Novel | null | undefined,
  savedChapters: [] as Chapter[],
  savedNovels: [] as Novel[],
  savedThrows: false,
  fetchCalls: [] as string[],
}));

vi.mock('../storage', () => ({
  getImportedNovel: async () => {
    if (h.importedThrows) throw new Error('IndexedDB unavailable');
    return h.importedNovel ?? undefined;
  },
  getImportedNovels: async () => (h.importedNovel ? [h.importedNovel] : []),
  getImportedChapters: async () => h.importedChapters,
}));

vi.mock('../storage/offline-books', () => ({
  getSavedSharedNovel: async () => {
    if (h.savedThrows) throw new Error('IndexedDB unavailable');
    return h.savedNovel ?? undefined;
  },
  getSavedSharedNovels: async () => (h.savedThrows ? Promise.reject(new Error('IndexedDB unavailable')) : h.savedNovels),
  getSavedSharedChapters: async () => h.savedChapters,
}));

const { clearNovelCache, fetchAllNovels, fetchNovel, fetchChapters } = await import('./index');

/* ── Fixtures ── */

function volume(novelId: string) {
  return { id: `${novelId}-vol-1`, novelId, volumeNumber: 1, title: 'Complete Edition', chapterCount: 1 };
}

function catalogChapter(novelId: string, content = ''): Chapter {
  return {
    id: `${novelId}-ch-1`,
    novelId,
    volumeId: `${novelId}-vol-1`,
    globalChapterNumber: 1,
    volumeChapterNumber: 1,
    title: 'Chapter 1',
    content,
    wordCount: 100,
    metadata: {},
  };
}

function novel(novelId: string): Novel {
  return {
    id: novelId,
    title: `Novel ${novelId}`,
    originalTitle: `Novel ${novelId}`,
    alternativeTitles: [],
    author: 'Author',
    description: 'Desc',
    cover: `./covers/${novelId}.jpg`,
    sourceLanguage: 'Japanese',
    translationLanguage: 'English',
    status: 'ongoing',
    genres: ['Fantasy'],
    tags: [],
    volumes: [volume(novelId)],
    chapters: [catalogChapter(novelId)],
    downloads: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function onlineFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://yomi.test').pathname;
    h.fetchCalls.push(path);
    if (!(path in routes)) return new Response('missing', { status: 404 });
    return jsonResponse(routes[path]);
  }));
}

function offlineFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    h.fetchCalls.push(new URL(String(input), 'https://yomi.test').pathname);
    throw new TypeError('fetch failed (offline)');
  }));
}

beforeEach(() => {
  clearNovelCache();
  h.importedNovel = null;
  h.importedChapters = [];
  h.importedThrows = false;
  h.savedNovel = null;
  h.savedChapters = [];
  h.savedNovels = [];
  h.savedThrows = false;
  h.fetchCalls = [];
  vi.unstubAllGlobals();
});

describe('online', () => {
  it('reads the catalog and chapters from the network', async () => {
    onlineFetch({
      '/data/novels.json': [novel('novel-1')],
      '/data/chapters/novel-1.json': [catalogChapter('novel-1', '<p>hi</p>')],
    });
    const novels = await fetchAllNovels();
    expect(novels.map((entry) => entry.id)).toEqual(['novel-1']);
    const chapters = await fetchChapters('novel-1');
    expect(chapters[0].content).toBe('<p>hi</p>');
    expect(h.fetchCalls).toEqual(['/data/novels.json', '/data/chapters/novel-1.json']);
  });

  it('prefers a personal import over the shared catalog entry with the same id', async () => {
    onlineFetch({ '/data/novels.json': [novel('novel-1')] });
    const personal = { ...novel('novel-1'), title: 'My personal copy' };
    h.importedNovel = personal;
    h.importedChapters = [catalogChapter('novel-1', '<p>personal</p>')];
    const found = await fetchNovel('novel-1');
    expect(found?.title).toBe('My personal copy');
    const chapters = await fetchChapters('novel-1');
    expect(chapters[0].content).toBe('<p>personal</p>');
    // A personal import must never be requested from the shared endpoint.
    expect(h.fetchCalls).not.toContain('/data/chapters/novel-1.json');
  });
});

describe('offline', () => {
  it('falls back to the saved shared snapshot for a saved book', async () => {
    offlineFetch();
    h.savedNovels = [novel('novel-1')];
    h.savedNovel = novel('novel-1');
    h.savedChapters = [catalogChapter('novel-1', '<p>saved</p>')];

    const novels = await fetchAllNovels();
    expect(novels.map((entry) => entry.id)).toEqual(['novel-1']);
    const chapters = await fetchChapters('novel-1');
    expect(chapters[0].content).toBe('<p>saved</p>');
  });

  it('serves an offline reader route for a saved book end to end', async () => {
    offlineFetch();
    h.savedNovels = [novel('orv')];
    h.savedNovel = novel('orv');
    h.savedChapters = [catalogChapter('orv', '<p>offline text</p>')];

    const found = await fetchNovel('orv');
    expect(found?.id).toBe('orv');
    const chapters = await fetchChapters('orv');
    expect(chapters).toHaveLength(1);
    expect(chapters[0].content).toContain('offline text');
  });

  it('surfaces the network error when nothing was saved for the book', async () => {
    offlineFetch();
    await expect(fetchChapters('unsaved')).rejects.toThrow(/Chapter request failed|fetch failed/);
  });

  it('returns null for a shared title that is neither cached nor saved', async () => {
    offlineFetch();
    expect(await fetchNovel('unsaved')).toBeNull();
  });

  it('rejects a tampered saved snapshot rather than serving the wrong book', async () => {
    offlineFetch();
    h.savedNovel = novel('novel-1');
    // The stored chapters belong to a different novel.
    h.savedChapters = [catalogChapter('novel-9', '<p>wrong</p>')];
    await expect(fetchChapters('novel-1')).rejects.toThrow(/Chapter request failed|fetch failed/);
  });

  it('refuses to touch the network when local storage cannot be checked', async () => {
    onlineFetch({ '/data/chapters/novel-1.json': [catalogChapter('novel-1')] });
    h.importedThrows = true;
    await expect(fetchChapters('novel-1')).rejects.toThrow(/Could not check your local book storage/);
    expect(h.fetchCalls).toEqual([]);
  });

  it('serves a personal import with no network at all', async () => {
    offlineFetch();
    h.importedNovel = novel('mine');
    h.importedChapters = [catalogChapter('mine', '<p>mine</p>')];
    const chapters = await fetchChapters('mine');
    expect(chapters[0].content).toBe('<p>mine</p>');
    expect(h.fetchCalls).toEqual([]);
  });
});
