import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    calls: 0,
    result: { data: [] as unknown, error: null as unknown },
  };
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'range']) b[method] = () => b;
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.result).then(resolve);
    return b;
  }
  const client = {
    from: () => {
      state.calls += 1;
      return builder();
    },
  };
  return { state, client };
});

vi.mock('./supabase', () => ({
  getCommunityClient: async () => h.client,
  requireCommunityClient: async () => h.client,
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

const {
  clearRatingCache,
  formatRating,
  getCachedNovelRating,
  getNovelRating,
  loadNovelRatings,
  roundedStars,
} = await import('./ratings');

beforeEach(() => {
  clearRatingCache();
  h.state.calls = 0;
  h.state.result = { data: [], error: null };
});

describe('formatting helpers', () => {
  it('formats averages and rounds stars', () => {
    expect(formatRating(4.25)).toBe('4.3');
    expect(formatRating(null)).toBe('—');
    expect(roundedStars(4.6)).toBe(5);
    expect(roundedStars(3.2)).toBe(3);
    expect(roundedStars(null)).toBe(0);
  });
});

describe('loadNovelRatings', () => {
  it('batches many novels into a single query', async () => {
    h.state.result = {
      data: [
        { novel_id: 'a', average_rating: '4.50', rating_count: 10 },
        { novel_id: 'b', average_rating: 3, rating_count: 2 },
      ],
      error: null,
    };
    const map = await loadNovelRatings(['a', 'b', 'c']);
    expect(h.state.calls).toBe(1);
    expect(map.get('a')).toEqual({ novelId: 'a', average: 4.5, count: 10 });
    expect(map.get('b')).toEqual({ novelId: 'b', average: 3, count: 2 });
    expect(map.get('c')).toEqual({ novelId: 'c', average: null, count: 0 });
  });

  it('serves repeat reads from the cache', async () => {
    h.state.result = { data: [{ novel_id: 'a', average_rating: 5, rating_count: 1 }], error: null };
    await loadNovelRatings(['a']);
    await loadNovelRatings(['a']);
    expect(h.state.calls).toBe(1);
    expect(getCachedNovelRating('a')?.average).toBe(5);
  });

  it('shares one in-flight request for concurrent callers', async () => {
    h.state.result = { data: [{ novel_id: 'z', average_rating: 2, rating_count: 3 }], error: null };
    const [first, second] = await Promise.all([loadNovelRatings(['z']), loadNovelRatings(['z'])]);
    expect(h.state.calls).toBe(1);
    expect(first.get('z')?.count).toBe(3);
    expect(second.get('z')?.count).toBe(3);
  });

  it('degrades to zero ratings when the query fails', async () => {
    h.state.result = { data: null, error: { message: 'boom' } };
    const rating = await getNovelRating('a');
    expect(rating).toEqual({ novelId: 'a', average: null, count: 0 });
  });

  it('never queries for an empty id list', async () => {
    await loadNovelRatings([]);
    await loadNovelRatings(['', '']);
    expect(h.state.calls).toBe(0);
  });
});
