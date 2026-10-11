import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { configured: true, result: { data: [] as unknown, error: null as unknown }, calls: 0 };
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) b[method] = () => b;
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.result).then(resolve);
    return b;
  }
  const client = { from: () => { state.calls += 1; return builder(); } };
  return { state, client };
});

vi.mock('./supabase', () => ({
  getCommunityClient: async () => (h.state.configured ? h.client : null),
  requireCommunityClient: async () => h.client,
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

const { listCommentRevisions } = await import('./comments');

beforeEach(() => {
  h.state.configured = true;
  h.state.calls = 0;
  h.state.result = { data: [], error: null };
});

describe('listCommentRevisions', () => {
  it('returns an empty list when community is not configured', async () => {
    h.state.configured = false;
    expect(await listCommentRevisions('c1')).toEqual([]);
    expect(h.state.calls).toBe(0);
  });

  it('maps revision rows to camelCase, oldest first', async () => {
    h.state.result = {
      data: [
        { id: 1, comment_id: 'c1', previous_body: 'first draft', revised_at: '2026-01-01T00:00:00Z' },
        { id: 2, comment_id: 'c1', previous_body: 'second draft', revised_at: '2026-01-02T00:00:00Z' },
      ],
      error: null,
    };
    const revisions = await listCommentRevisions('c1');
    expect(revisions).toEqual([
      { id: '1', commentId: 'c1', previousBody: 'first draft', revisedAt: '2026-01-01T00:00:00Z' },
      { id: '2', commentId: 'c1', previousBody: 'second draft', revisedAt: '2026-01-02T00:00:00Z' },
    ]);
  });

  it('degrades to an empty list on a read error (e.g. another reader)', async () => {
    h.state.result = { data: null, error: { message: 'permission denied' } };
    expect(await listCommentRevisions('c1')).toEqual([]);
  });
});
