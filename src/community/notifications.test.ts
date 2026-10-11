import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { configured: true, result: { data: [] as unknown, error: null as unknown }, count: 0 as number | null, rpcResult: { data: 0 as unknown, error: null as unknown }, calls: 0 };
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'range', 'update']) b[method] = () => b;
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ ...state.result, count: state.count }).then(resolve);
    return b;
  }
  return {
    state,
    client: {
      from: () => { state.calls += 1; return builder(); },
      rpc: () => { state.calls += 1; return Promise.resolve(state.rpcResult); },
    },
  };
});

vi.mock('./supabase', () => ({
  getCommunityClient: async () => (h.state.configured ? h.client : null),
  requireCommunityClient: async () => h.client,
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

const {
  getUnreadNotificationCount,
  listNotifications,
  mapNotificationRow,
  markAllNotificationsRead,
  notificationPreview,
  notificationTargetPath,
} = await import('./notifications');

beforeEach(() => {
  h.state.configured = true;
  h.state.calls = 0;
  h.state.result = { data: [], error: null };
  h.state.count = 0;
  h.state.rpcResult = { data: 0, error: null };
});

describe('notification target routes', () => {
  it('opens the reader for a chapter notification', () => {
    expect(notificationTargetPath({ novelId: 'novel-1', chapterId: 'ch-2' })).toBe('reader/novel-1/ch-2');
  });
  it('opens the novel page for novel-level activity', () => {
    expect(notificationTargetPath({ novelId: 'novel-1', chapterId: null })).toBe('novel/novel-1');
  });
  it('encodes ids so a hostile id cannot change the route', () => {
    expect(notificationTargetPath({ novelId: 'a/b', chapterId: null })).toBe('novel/a%2Fb');
  });
});

describe('notification row mapping', () => {
  it('maps snake_case rows and collapses previews', () => {
    const mapped = mapNotificationRow({
      id: 7,
      kind: 'mention',
      novel_id: 'novel-1',
      chapter_id: null,
      comment_id: 'c1',
      created_at: '2026-01-01T00:00:00Z',
      read_at: null,
      actor: { id: 'u2', username: 'bob', avatar_path: 'u2/a.png' },
      comment: { body: 'hello\n\n  @alice   there', status: 'visible' },
    });
    expect(mapped.id).toBe('7');
    expect(mapped.kind).toBe('mention');
    expect(mapped.actor?.username).toBe('bob');
    expect(mapped.preview).toBe('hello @alice there');
  });

  it('truncates long previews and tolerates a missing comment', () => {
    expect(notificationPreview('x'.repeat(400))?.length).toBe(120);
    expect(notificationPreview(null)).toBeNull();
    expect(mapNotificationRow({
      id: '1', kind: 'unknown', novel_id: 'n', chapter_id: null, comment_id: null,
      created_at: 'now', read_at: 'now', actor: null, comment: null,
    }).kind).toBe('reply');
  });
});

describe('notification reads', () => {
  it('returns an empty page when community is unconfigured', async () => {
    h.state.configured = false;
    expect(await listNotifications()).toMatchObject({ notifications: [], total: 0, hasMore: false });
    expect(await getUnreadNotificationCount()).toBe(0);
    expect(h.state.calls).toBe(0);
  });

  it('pages notifications with a total and hasMore', async () => {
    h.state.result = {
      data: [{
        id: 1, kind: 'like', novel_id: 'novel-1', chapter_id: null, comment_id: 'c1',
        created_at: '2026-01-01T00:00:00Z', read_at: null, actor: null, comment: null,
      }],
      error: null,
    };
    h.state.count = 5;
    const page = await listNotifications(0);
    expect(page.notifications).toHaveLength(1);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(true);
  });

  it('reads the unread count from the head query', async () => {
    h.state.count = 3;
    expect(await getUnreadNotificationCount()).toBe(3);
  });

  it('reports how many rows mark-all-read changed', async () => {
    h.state.rpcResult = { data: 4, error: null };
    expect(await markAllNotificationsRead()).toBe(4);
  });
});
