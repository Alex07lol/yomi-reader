/* ─── Shelf updates ───
   Answers one question for the navbar: which of the novels this reader shelved
   have gained chapters since they last looked? Pure and dependency-free so the
   component and its tests share exactly the same rule. */

export interface ShelvedNovelSummary {
  id: string;
  title: string;
  chapterCount: number;
}

export interface ShelfUpdate {
  novelId: string;
  title: string;
  /** Chapters published since the reader last saw this novel. */
  newChapters: number;
  chapterCount: number;
}

/** Chapter count of a novel record, tolerating a missing list. */
export function countChapters(novel: { chapters?: unknown[] }): number {
  return Array.isArray(novel.chapters) ? novel.chapters.length : 0;
}

/**
 * Novels that are on a shelf and have gained chapters since their baseline.
 * A novel with no baseline is skipped: nothing has been acknowledged yet, so
 * there is nothing to compare against (see `baselinesToEstablish`).
 */
export function computeShelfUpdates(
  novels: ShelvedNovelSummary[],
  shelves: { novelId: string; deleted?: boolean }[],
  baselines: Record<string, number>,
): ShelfUpdate[] {
  const shelved = new Set(shelves.filter(row => !row.deleted).map(row => row.novelId));
  const updates: ShelfUpdate[] = [];

  for (const novel of novels) {
    if (!shelved.has(novel.id)) continue;
    const seen = baselines[novel.id];
    if (typeof seen !== 'number' || !Number.isFinite(seen)) continue;
    const newChapters = novel.chapterCount - seen;
    if (newChapters > 0) {
      updates.push({ novelId: novel.id, title: novel.title, newChapters, chapterCount: novel.chapterCount });
    }
  }

  return updates.sort((a, b) => b.newChapters - a.newChapters || a.title.localeCompare(b.title));
}

/**
 * Shelved novels with no baseline yet. Their first sighting just records the
 * current count, so shelving a book never immediately looks like an update.
 */
export function baselinesToEstablish(
  novels: ShelvedNovelSummary[],
  shelves: { novelId: string; deleted?: boolean }[],
  baselines: Record<string, number>,
): { novelId: string; chapterCount: number }[] {
  const shelved = new Set(shelves.filter(row => !row.deleted).map(row => row.novelId));
  return novels
    .filter(novel => shelved.has(novel.id) && typeof baselines[novel.id] !== 'number')
    .map(novel => ({ novelId: novel.id, chapterCount: novel.chapterCount }));
}
