/* ─── API/Data Layer ───
   Abstraction so the frontend can connect to JSON, REST, DB, or
   object storage without rewriting the reader.
   Current implementation: fetch from public/data/*.json
*/

import type { Novel, Chapter, LibraryOptions } from '../models';

/* ─── Fetch functions ─── */

let _novelsCache: Novel[] | null = null;
const _chaptersCache = new Map<string, Chapter[]>();

export async function apiFetchNovels(): Promise<Novel[]> {
  if (_novelsCache) return _novelsCache;
  const resp = await fetch('/data/novels.json');
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching novels`);
  _novelsCache = (await resp.json()) as Novel[];
  return _novelsCache;
}

export async function apiFetchNovel(id: string): Promise<Novel | null> {
  const novels = await apiFetchNovels();
  return novels.find(n => n.id === id) ?? null;
}

export async function apiFetchChapters(novelId: string): Promise<Chapter[]> {
  if (_chaptersCache.has(novelId)) return _chaptersCache.get(novelId)!;
  const resp = await fetch(`/data/chapters/${novelId}.json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching chapters for ${novelId}`);
  const chapters = await resp.json();
  _chaptersCache.set(novelId, chapters);
  return chapters;
}

export async function apiFetchChapter(chapterId: string, novelId: string): Promise<Chapter | null> {
  const chapters = await apiFetchChapters(novelId);
  return chapters.find(c => c.id === chapterId) ?? null;
}

export async function apiFetchLibraryOptions(): Promise<LibraryOptions> {
  const novels = await apiFetchNovels();
  return {
    genres: [...new Set(novels.flatMap(n => n.genres))].sort(),
    tags: [...new Set(novels.flatMap(n => n.tags))].sort(),
    sourceLanguages: [...new Set(novels.map(n => n.sourceLanguage))].sort(),
    translationLanguages: [...new Set(novels.map(n => n.translationLanguage))].sort(),
  };
}

export async function apiSearchNovels(query: string): Promise<Novel[]> {
  const novels = await apiFetchNovels();
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

/* ─── Invalidate cache ─── */

export function apiInvalidateCache(): void {
  _novelsCache = null;
  _chaptersCache.clear();
}

/* ─── Future: REST-backed overrides ───
export async function apiFetchNovels(): Promise<Novel[]> {
  const resp = await fetch('/api/novels');
  return resp.json();
}
*/