/* ─── Rating aggregation service ───
   Reads the `novel_rating_summary` / `novel_rating_distribution` views, which
   are `security_invoker` and therefore already filtered by RLS: only visible
   reviews are ever counted. Reads are cached and batched so a library grid
   never fires one request per card. */

import { getCommunityClient } from './supabase';
import { clearCommunityCache } from './comments';
import type { NovelRating, NovelRatingDistribution } from './types';

const cache = new Map<string, NovelRating>();
let inflight: Promise<void> | null = null;

export function clearRatingCache(): void {
  cache.clear();
  inflight = null;
  clearCommunityCache();
}

/** Synchronously returns a previously loaded summary, if any. */
export function getCachedNovelRating(novelId: string): NovelRating | null {
  return cache.get(novelId) ?? null;
}

function emptyRating(novelId: string): NovelRating {
  return { novelId, average: null, count: 0 };
}

function normalizeAverage(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function snapshot(ids: string[]): Map<string, NovelRating> {
  const map = new Map<string, NovelRating>();
  for (const id of ids) map.set(id, cache.get(id) ?? emptyRating(id));
  return map;
}

/** Batches one query for many novels and fills the cache. Never throws. */
export async function loadNovelRatings(novelIds: string[]): Promise<Map<string, NovelRating>> {
  const ids = [...new Set(novelIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const missing = ids.filter((id) => !cache.has(id));
  if (missing.length === 0) return snapshot(ids);

  // A batch is already in flight: let it settle, then fetch anything left.
  if (inflight) {
    await inflight.catch(() => undefined);
    const stillMissing = ids.filter((id) => !cache.has(id));
    if (stillMissing.length > 0) await loadNovelRatings(stillMissing);
    return snapshot(ids);
  }

  inflight = (async () => {
    const client = await getCommunityClient();
    if (!client) {
      for (const id of missing) cache.set(id, emptyRating(id));
      return;
    }
    try {
      const { data, error } = await client
        .from('novel_rating_summary')
        .select('novel_id,average_rating,rating_count')
        .in('novel_id', missing);
      if (error) throw error;
      const rows = (data ?? []) as {
        novel_id: string;
        average_rating: number | string | null;
        rating_count: number | string | null;
      }[];
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.novel_id);
        cache.set(row.novel_id, {
          novelId: row.novel_id,
          average: normalizeAverage(row.average_rating),
          count: Number(row.rating_count) || 0,
        });
      }
      for (const id of missing) {
        if (!seen.has(id)) cache.set(id, emptyRating(id));
      }
    } catch {
      // Ratings are decorative; a failure must never block the library.
      for (const id of missing) cache.set(id, emptyRating(id));
    }
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }
  return snapshot(ids);
}

/** Convenience for a single novel (novel detail page). */
export async function getNovelRating(novelId: string): Promise<NovelRating> {
  const map = await loadNovelRatings([novelId]);
  return map.get(novelId) ?? emptyRating(novelId);
}

/** Distribution of 1★–5★ across visible reviews. */
export async function getRatingDistribution(novelId: string): Promise<NovelRatingDistribution[]> {
  const buckets: NovelRatingDistribution[] = [1, 2, 3, 4, 5].map((stars) => ({ novelId, stars, count: 0 }));
  const client = await getCommunityClient();
  if (!client) return buckets;
  try {
    const { data, error } = await client
      .from('novel_rating_distribution')
      .select('stars,star_count')
      .eq('novel_id', novelId);
    if (error) throw error;
    const rows = (data ?? []) as { stars: number | string; star_count: number | string }[];
    for (const row of rows) {
      const bucket = buckets.find((b) => b.stars === Number(row.stars));
      if (bucket) bucket.count = Number(row.star_count) || 0;
    }
  } catch {
    // Return zeroed buckets rather than failing the page.
  }
  return buckets;
}

/** Display helper: "4.5" or "—". */
export function formatRating(average: number | null): string {
  return average === null ? '—' : average.toFixed(1);
}

/** Rounds a rating to the nearest whole star for compact icons. */
export function roundedStars(average: number | null): number {
  if (average === null) return 0;
  return Math.max(0, Math.min(5, Math.round(average)));
}
