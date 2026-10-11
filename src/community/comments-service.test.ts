import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    fromCalls: 0,
    result: { data: [] as unknown, error: null as unknown, count: 0 as number | null },
  };

  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'range', 'limit', 'insert', 'update', 'delete']) {
      b[method] = () => b;
    }
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.result).then(resolve);
    return b;
  }

  const client = {
    from: () => {
      state.fromCalls += 1;
      return builder();
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    rpc: async () => ({ error: null }),
  };

  return { state, client };
});

vi.mock('./supabase', () => ({
  requireCommunityClient: async () => h.client,
  getCommunityClient: async () => h.client,
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

const { createComment, getCommentCount, listComments, reportComment, toggleLike, CommunityError } = await import('./comments');

beforeEach(() => {
  h.state.fromCalls = 0;
  h.state.result = { data: [], error: null, count: 0 };
});

describe('scoped reads', () => {
  it('does not fetch when the scope is invalid', async () => {
    await expect(listComments({ novelId: '', chapterId: null }, 'newest')).rejects.toBeInstanceOf(CommunityError);
    expect(h.state.fromCalls).toBe(0);
  });

  it('shares one in-flight request for identical queries', async () => {
    const scope = { novelId: 'novel-1', chapterId: 'chapter-1' };
    const [a, b] = await Promise.all([listComments(scope, 'newest', 0), listComments(scope, 'newest', 0)]);
    expect(h.state.fromCalls).toBe(1);
    expect(a.comments).toEqual([]);
    expect(b.total).toBe(0);

    // A later call is a fresh request once the in-flight entry is cleared.
    await listComments(scope, 'newest', 0);
    expect(h.state.fromCalls).toBe(2);
  });

  it('returns the exact comment count', async () => {
    h.state.result = { data: null, error: null, count: 7 };
    await expect(getCommentCount({ novelId: 'novel-1', chapterId: null })).resolves.toBe(7);
  });
});

describe('write guards', () => {
  it('refuses a chapter-scoped review before touching the network', async () => {
    await expect(createComment({ novelId: 'novel-1', chapterId: 'ch-1' }, 'review', { kind: 'review' }))
      .rejects.toBeInstanceOf(CommunityError);
    expect(h.state.fromCalls).toBe(0);
  });

  it('refuses an empty body', async () => {
    await expect(createComment({ novelId: 'novel-1', chapterId: null }, '   ')).rejects.toBeInstanceOf(CommunityError);
  });

  it('treats a duplicate like as success', async () => {
    h.state.result = { data: null, error: { code: '23505', message: 'duplicate key value' }, count: null };
    await expect(toggleLike('comment-1', true)).resolves.toBeUndefined();
  });

  it('rejects oversized report details', async () => {
    await expect(reportComment('comment-1', 'spam', 'x'.repeat(501))).rejects.toBeInstanceOf(CommunityError);
  });
});
