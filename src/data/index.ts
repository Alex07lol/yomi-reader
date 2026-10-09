/* ─── Data / API Abstraction Layer ───
   Swap the implementation below to connect to a REST API, database,
   or object storage without rewriting the reader / UI.
*/

import type { Novel, Chapter, LibraryOptions, ReadingProgress } from '../models';
import { getImportedChapters, getImportedNovel, getImportedNovels } from '../storage';
import { getSavedSharedChapters, getSavedSharedNovel, getSavedSharedNovels } from '../storage/offline-books';

/* ─── Internal state ─── */
let novelsCache: Novel[] | null = null;
let chaptersCache = new Map<string, Chapter[]>(); // source + novelId → chapters
let personalNovelIds = new Set<string>();
let savedSharedNovelIds = new Set<string>();
let publicCatalogNovelIds = new Set<string>();
let libraryStatusAvailable = false;

export type LibraryNovelAvailability = 'personal' | 'saved-shared' | 'shared' | 'unknown';

export function getLibraryNovelAvailability(novelId: string): LibraryNovelAvailability {
  if (!libraryStatusAvailable) return 'unknown';
  if (personalNovelIds.has(novelId)) return 'personal';
  return savedSharedNovelIds.has(novelId) ? 'saved-shared' : 'shared';
}

/** Refresh source labels once per library render, never once per card. */
export async function refreshLibraryNovelAvailability(): Promise<void> {
  const [importedResult, savedResult] = await Promise.allSettled([
    getImportedNovels(),
    getSavedSharedNovels(),
  ]);
  if (importedResult.status !== 'fulfilled' || savedResult.status !== 'fulfilled') {
    libraryStatusAvailable = false;
    return;
  }
  personalNovelIds = new Set(importedResult.value.filter(isNovelRecord).map(novel => novel.id));
  savedSharedNovelIds = new Set(savedResult.value.filter(isNovelRecord).map(novel => novel.id));
  libraryStatusAvailable = true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyText(value: unknown): value is string {
  return isText(value) && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isText);
}

function isNovelRecord(value: unknown): value is Novel {
  if (!isRecord(value)) return false;
  const novel = value;
  if (!isNonEmptyText(novel.id) || !isNonEmptyText(novel.title) ||
      !isText(novel.originalTitle) || !isStringArray(novel.alternativeTitles) ||
      !isNonEmptyText(novel.author) || !isText(novel.description) || !isText(novel.cover) ||
      !isNonEmptyText(novel.sourceLanguage) || !isNonEmptyText(novel.translationLanguage) ||
      !['ongoing', 'completed', 'hiatus', 'dropped'].includes(String(novel.status)) ||
      !isStringArray(novel.genres) || !isStringArray(novel.tags) ||
      !isNonNegativeNumber(novel.createdAt) || !isNonNegativeNumber(novel.updatedAt) ||
      !Array.isArray(novel.volumes) || !Array.isArray(novel.chapters) || !Array.isArray(novel.downloads)) {
    return false;
  }

  const volumeIds = new Set<string>();
  for (const item of novel.volumes) {
    if (!isRecord(item) || !isNonEmptyText(item.id) || item.novelId !== novel.id ||
        !isPositiveNumber(item.volumeNumber) || !isNonEmptyText(item.title) ||
        !isNonNegativeNumber(item.chapterCount) ||
        (item.cover !== undefined && !isText(item.cover)) ||
        (item.downloadUrl !== undefined && !isText(item.downloadUrl)) || volumeIds.has(item.id)) {
      return false;
    }
    volumeIds.add(item.id);
  }

  const chapterIds = new Set<string>();
  for (const item of novel.chapters) {
    // Catalog chapters intentionally omit `content`; tolerate it only when a
    // saved snapshot includes a well-formed full chapter.
    if (!isRecord(item) || !isNonEmptyText(item.id) || item.novelId !== novel.id ||
        !isNonEmptyText(item.volumeId) || !volumeIds.has(item.volumeId) ||
        !isPositiveNumber(item.globalChapterNumber) || !isPositiveNumber(item.volumeChapterNumber) ||
        !isNonEmptyText(item.title) || !isNonNegativeNumber(item.wordCount) ||
        (item.content !== undefined && !isText(item.content)) ||
        (item.metadata !== undefined && !isStringRecord(item.metadata)) || chapterIds.has(item.id)) {
      return false;
    }
    chapterIds.add(item.id);
  }

  const downloadIds = new Set<string>();
  for (const item of novel.downloads) {
    if (!isRecord(item) || !isNonEmptyText(item.id) || item.novelId !== novel.id ||
        !['complete', 'volume'].includes(String(item.type)) || !isNonEmptyText(item.label) ||
        !isText(item.url) || !isNonNegativeNumber(item.size) || !isNonEmptyText(item.language) ||
        (item.volumeId !== undefined && !isNonEmptyText(item.volumeId)) ||
        (item.type === 'volume' && (!isNonEmptyText(item.volumeId) || !volumeIds.has(item.volumeId))) ||
        downloadIds.has(item.id)) {
      return false;
    }
    downloadIds.add(item.id);
  }
  return true;
}

function isChapterList(value: unknown, novelId: string): value is Chapter[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!isRecord(item) || item.novelId !== novelId || !isNonEmptyText(item.id) ||
        !isNonEmptyText(item.volumeId) || !isPositiveNumber(item.globalChapterNumber) ||
        !isPositiveNumber(item.volumeChapterNumber) || !isNonEmptyText(item.title) ||
        !isText(item.content) || !isNonNegativeNumber(item.wordCount) ||
        !isStringRecord(item.metadata) || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

async function fetchPublicCatalog(): Promise<Novel[]> {
  const response = await fetch('/data/novels.json');
  if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isNovelRecord)) {
    throw new Error('The shared catalog is invalid.');
  }
  return payload;
}

/* ─── Public interface ─── */

export async function fetchAllNovels(): Promise<Novel[]> {
  if (novelsCache) return novelsCache;

  const [catalogResult, importedResult, savedResult] = await Promise.allSettled([
    fetchPublicCatalog(),
    getImportedNovels(),
    getSavedSharedNovels(),
  ]);

  const imported = importedResult.status === 'fulfilled' ? importedResult.value.filter(isNovelRecord) : [];
  // Do not promote a saved shared snapshot if the personal store could not be
  // checked; a reader may have a private import with the same ID.
  const saved = importedResult.status === 'fulfilled' && savedResult.status === 'fulfilled'
    ? savedResult.value.filter(isNovelRecord)
    : [];
  const catalog = catalogResult.status === 'fulfilled'
    ? catalogResult.value
    : (novelsCache ?? []);
  if (catalogResult.status === 'fulfilled') {
    publicCatalogNovelIds = new Set(catalog.map(novel => novel.id));
  }

  // Shared public entries win over older saved snapshots. Keep saved entries
  // that are no longer published available to their owner on this device.
  const byId = new Map(catalog.map(novel => [novel.id, novel]));
  saved.forEach(novel => { if (!byId.has(novel.id)) byId.set(novel.id, novel); });
  // A reader's personal import always wins, even if its ID matches a shared
  // title. Work on the catalog map only; do not mutate stored records.
  imported.forEach(novel => byId.set(novel.id, novel));

  personalNovelIds = new Set(imported.map(novel => novel.id));
  savedSharedNovelIds = new Set(saved.map(novel => novel.id));
  // If either IndexedDB lookup failed, do not claim that any shared book is
  // saved or online-only; the library can still render its normal catalog.
  libraryStatusAvailable = importedResult.status === 'fulfilled' && savedResult.status === 'fulfilled';
  novelsCache = [...byId.values()];
  return novelsCache;
}

export function clearNovelCache(): void {
  novelsCache = null;
  chaptersCache.clear();
  personalNovelIds.clear();
  savedSharedNovelIds.clear();
  publicCatalogNovelIds.clear();
  libraryStatusAvailable = false;
}

export async function fetchNovel(id: string): Promise<Novel | null> {
  // Preserve the reader's own import if a shared catalog entry uses the same ID.
  let personalLookupSucceeded = true;
  let imported: Novel | undefined;
  try {
    imported = await getImportedNovel(id);
  } catch {
    personalLookupSucceeded = false;
  }
  if (imported) {
    if (!isNovelRecord(imported)) throw new Error('The imported book data is incomplete or invalid.');
    return imported;
  }

  const all = await fetchAllNovels();
  const novel = all.find(n => n.id === id);
  if (novel && (personalLookupSucceeded || publicCatalogNovelIds.has(id))) return novel;

  // The catalog may be unavailable or a title may have been unpublished since
  // it was saved. Only the shared snapshot store is consulted here.
  if (!personalLookupSucceeded) return null;
  try {
    const saved = await getSavedSharedNovel(id);
    return saved && saved.id === id && isNovelRecord(saved) ? saved : null;
  } catch { return null; }
}

export async function fetchChapters(novelId: string): Promise<Chapter[]> {
  let personalLookupSucceeded = true;
  let importedNovel: Novel | undefined;
  try {
    importedNovel = await getImportedNovel(novelId);
  } catch {
    personalLookupSucceeded = false;
  }
  // Without knowing whether this is a personal import, never expose the ID to
  // the shared network endpoint or shared fallback stores.
  if (!personalLookupSucceeded) {
    throw new Error('Could not check your local book storage. Please try again before opening this chapter.');
  }
  const sourceKey = `${importedNovel ? 'personal' : 'shared'}:${novelId}`;
  if (chaptersCache.has(sourceKey)) return chaptersCache.get(sourceKey)!;
  if (importedNovel) {
    if (!isNovelRecord(importedNovel)) throw new Error('The imported book data is incomplete or invalid.');
    const chapters = await getImportedChapters(novelId);
    if (!isChapterList(chapters, novelId)) throw new Error('The imported chapter data is incomplete or invalid.');
    chaptersCache.set(sourceKey, chapters);
    return chapters;
  }

  try {
    const response = await fetch(`/data/chapters/${encodeURIComponent(novelId)}.json`);
    if (!response.ok) throw new Error(`Chapter request failed (${response.status}).`);
    const payload: unknown = await response.json();
    if (!isChapterList(payload, novelId)) throw new Error('The shared chapter data is invalid.');
    chaptersCache.set(sourceKey, payload);
    return payload;
  } catch (sharedError) {
    if (!personalLookupSucceeded) throw sharedError;
    try {
      const [savedNovel, savedChapters] = await Promise.all([
        getSavedSharedNovel(novelId),
        getSavedSharedChapters(novelId),
      ]);
      if (savedNovel?.id === novelId && isNovelRecord(savedNovel) && isChapterList(savedChapters, novelId)) {
        chaptersCache.set(sourceKey, savedChapters);
        return savedChapters;
      }
    } catch {
      // Keep the original public-fetch failure as the actionable reader error.
    }
    throw sharedError;
  }
}

export async function fetchChapter(chapterId: string, novelId: string): Promise<Chapter | null> {
  const chapters = await fetchChapters(novelId);
  return chapters.find(c => c.id === chapterId) ?? null;
}

export async function fetchLibraryOptions(): Promise<LibraryOptions> {
  const novels = await fetchAllNovels();
  const genres = [...new Set(novels.flatMap(n => n.genres))].sort();
  const tags = [...new Set(novels.flatMap(n => n.tags))].sort();
  const sourceLanguages = [...new Set(novels.map(n => n.sourceLanguage))].sort();
  const translationLanguages = [...new Set(novels.map(n => n.translationLanguage))].sort();
  return { genres, tags, sourceLanguages, translationLanguages };
}

/* Merge reading progress (from IndexedDB) into novels for the UI */
export function mergeProgressIntoNovels(
  novels: Novel[],
  progressList: ReadingProgress[],
): (Novel & { readingProgress?: ReadingProgress })[] {
  const map = new Map(progressList.map(p => [p.novelId, p]));
  return novels.map(n => ({
    ...n,
    readingProgress: map.get(n.id),
  }));
}

/* ─── For future: API-backed overrides ───

   Replace the fetch calls above with:
   export async function fetchAllNovels(): Promise<Novel[]> {
     const resp = await fetch('/api/novels');
     return resp.json();
   }

   The rest of the UI stays identical.
*/
