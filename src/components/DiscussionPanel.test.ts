import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityComment } from '../community';

const mocks = vi.hoisted(() => ({
  listComments: vi.fn(),
  getCommentCount: vi.fn(async () => 0),
  getSession: vi.fn(async () => null as unknown),
  isModerator: vi.fn(async () => false),
}));

vi.mock('../community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../community')>();
  return {
    ...actual,
    isCommunityConfigured: () => true,
    getCommunityAvailability: () => 'ready',
    onCommunityEvent: () => () => {},
    clearCommunityCache: () => {},
    listComments: mocks.listComments,
    getCommentCount: mocks.getCommentCount,
    getSession: mocks.getSession,
    isModerator: mocks.isModerator,
  };
});

const { DiscussionPanel } = await import('./DiscussionPanel');

function comment(overrides: Partial<CommunityComment> = {}): CommunityComment {
  return {
    id: 'c1',
    authorId: 'u1',
    novelId: 'novel-1',
    chapterId: null,
    kind: 'comment',
    body: 'A perfectly ordinary comment.',
    rating: null,
    parentId: null,
    status: 'visible',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: { id: 'u1', username: 'reader', avatarPath: null },
    likeCount: 0,
    likedByMe: false,
    replyCount: 0,
    ...overrides,
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  mocks.listComments.mockReset();
  mocks.listComments.mockResolvedValue({ comments: [], total: 0, nextOffset: 0, hasMore: false });
  mocks.getCommentCount.mockResolvedValue(0);
  mocks.getSession.mockResolvedValue(null);
  mocks.isModerator.mockResolvedValue(false);
});

describe('DiscussionPanel', () => {
  it('loads on open and shows an empty state', async () => {
    const panel = new DiscussionPanel({ scope: { novelId: 'novel-1', chapterId: null }, startOpen: true });
    document.body.appendChild(panel.element);
    await flush();
    expect(mocks.listComments).toHaveBeenCalledTimes(1);
    expect(panel.element.querySelector('.community-empty')?.textContent).toContain('No comments yet');
    panel.dispose();
  });

  it('loads the first page only once even if opened repeatedly', async () => {
    const panel = new DiscussionPanel({ scope: { novelId: 'novel-1', chapterId: null } });
    document.body.appendChild(panel.element);
    panel.open();
    panel.open();
    await flush();
    expect(mocks.listComments).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it('renders comment bodies as text, never as HTML', async () => {
    const payload = '<img src=x onerror="window.__communityXss=1">';
    mocks.listComments.mockResolvedValue({
      comments: [comment({ body: payload })],
      total: 1,
      nextOffset: 1,
      hasMore: false,
    });
    const panel = new DiscussionPanel({ scope: { novelId: 'novel-1', chapterId: null }, startOpen: true });
    document.body.appendChild(panel.element);
    await flush();

    const body = panel.element.querySelector('.community-comment-body');
    expect(body?.textContent).toBe(payload);
    expect(panel.element.querySelector('img')).toBeNull();
    expect((window as unknown as { __communityXss?: number }).__communityXss).toBeUndefined();
    panel.dispose();
  });

  it('shows a sign-in prompt to signed-out readers', async () => {
    const panel = new DiscussionPanel({ scope: { novelId: 'novel-1', chapterId: null }, startOpen: true });
    document.body.appendChild(panel.element);
    await flush();
    expect(panel.element.querySelector('.community-signin-prompt')).not.toBeNull();
    panel.dispose();
  });

  it('disposes cleanly', async () => {
    const panel = new DiscussionPanel({ scope: { novelId: 'novel-1', chapterId: null }, startOpen: true });
    document.body.appendChild(panel.element);
    await flush();
    panel.dispose();
    expect(document.querySelector('.community-panel')).toBeNull();
  });
});
