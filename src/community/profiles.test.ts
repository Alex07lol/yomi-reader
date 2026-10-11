import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { client: null as unknown, calls: 0, result: { data: null as unknown, error: null as unknown } };
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'update', 'maybeSingle', 'single']) b[method] = () => b;
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.result).then(resolve);
    return b;
  }
  return {
    state,
    client: {
      from: () => {
        state.calls += 1;
        return builder();
      },
    },
  };
});

vi.mock('./supabase', () => ({
  getCommunityClient: async () => h.state.client,
  getCommunityPublicUrl: () => 'https://example.supabase.co',
  requireCommunityClient: async () => h.client,
}));

const { getProfileByUsername, getProfileStats, avatarUrl } = await import('./profiles');

describe('public profile reads', () => {
  it('returns nothing when community is not configured', async () => {
    h.state.client = null;
    h.state.calls = 0;
    expect(await getProfileByUsername('alice')).toBeNull();
    expect(h.state.calls).toBe(0);
  });

  it('ignores blank usernames', async () => {
    h.state.client = h.client;
    h.state.calls = 0;
    expect(await getProfileByUsername('   ')).toBeNull();
    expect(h.state.calls).toBe(0);
  });

  it('maps a profile row', async () => {
    h.state.client = h.client;
    h.state.result = { data: { id: 'u1', username: 'alice', avatar_path: 'u1/a.png', created_at: '2026-01-01T00:00:00Z' }, error: null };
    const profile = await getProfileByUsername('Alice');
    expect(profile).toEqual({ id: 'u1', username: 'alice', avatarPath: 'u1/a.png', createdAt: '2026-01-01T00:00:00Z' });
  });
});

describe('profile stats', () => {
  it('returns zeroed stats when unavailable', async () => {
    h.state.client = null;
    const stats = await getProfileStats('u1');
    expect(stats).toEqual({
      userId: 'u1',
      chapterCommentCount: 0,
      novelCommentCount: 0,
      reviewCount: 0,
      likesReceived: 0,
    });
  });

  it('coerces numeric strings from the aggregate view', async () => {
    h.state.client = h.client;
    h.state.result = {
      data: { chapter_comment_count: '3', novel_comment_count: 2, review_count: '1', likes_received: 9 },
      error: null,
    };
    const stats = await getProfileStats('u1');
    expect(stats.chapterCommentCount).toBe(3);
    expect(stats.novelCommentCount).toBe(2);
    expect(stats.reviewCount).toBe(1);
    expect(stats.likesReceived).toBe(9);
  });
});

describe('avatarUrl', () => {
  it('builds a public storage URL and rejects empty paths', () => {
    expect(avatarUrl('u1/a.png')).toBe('https://example.supabase.co/storage/v1/object/public/avatars/u1/a.png');
    expect(avatarUrl(null)).toBeNull();
  });
});
