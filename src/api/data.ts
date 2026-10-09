/* ─── API / Data Layer (JSON) ───
   Frontend-facing data layer. Currently reads static JSON files
   from public/data/. Swap to REST by replacing fetch calls.
*/

import type { Novel, Chapter, LibraryOptions } from '../models';

/* ── Fetch all novels ── */

let _novelsCache: Novel[] | null = null;

export async function fetchNovels(): Promise<Novel[]> {
  if (_novelsCache) return _novelsCache;
  const resp = await fetch('/data/novels.json');
  if (!resp.ok) throw new Error(`Failed to fetch novels: HTTP ${resp.status}`);
  const novels = await resp.json();
  _novelsCache = novels;
  return novels;
}

export async function fetchNovel(id: string): Promise<Novel | null> {
  const novels = await fetchNovels();
  return novels.find(n => n.id === id) ?? null;
}

/* ── Fetch chapters ── */

const _chaptersCache = new Map<string, Chapter[]>();

export async function fetchChapters(novelId: string): Promise<Chapter[]> {
  if (_chaptersCache.has(novelId)) return _chaptersCache.get(novelId)!;
  const resp = await fetch(`/data/chapters/${novelId}.json`);
  if (!resp.ok) throw new Error(`Failed to fetch chapters for ${novelId}: HTTP ${resp.status}`);
  const chapters = await resp.json();
  _chaptersCache.set(novelId, chapters);
  return chapters;
}

export async function fetchChapter(chapterId: string, novelId: string): Promise<Chapter | null> {
  const chapters = await fetchChapters(novelId);
  return chapters.find(c => c.id === chapterId) ?? null;
}

/* ── Library options ── */

export async function fetchLibraryOptions(): Promise<LibraryOptions> {
  const novels = await fetchNovels();
  return {
    genres: [...new Set(novels.flatMap(n => n.genres))].sort(),
    tags: [...new Set(novels.flatMap(n => n.tags))].sort(),
    sourceLanguages: [...new Set(novels.map(n => n.sourceLanguage))].sort(),
    translationLanguages: [...new Set(novels.map(n => n.translationLanguage))].sort(),
  };
}

/* ── Search ── */

export async function searchNovels(query: string): Promise<Novel[]> {
  const novels = await fetchNovels();
  if (!query.trim()) return novels;
  const q = query.toLowerCase();
  return novels.filter(n =>
    n.title.toLowerCase().includes(q) ||
    n.originalTitle.toLowerCase().includes(q) ||
    n.alternativeTitles.some(t => t.toLowerCase().includes(q)) ||
    n.author.toLowerCase().includes(q) ||
    n.genres.some(g => g.toLowerCase().includes(q)) ||
    n.tags.some(t => t.toLowerCase().includes(q))
  );
}

/* ── Cache invalidation ── */

export function invalidateCache(): void {
  _novelsCache = null;
  _chaptersCache.clear();
}