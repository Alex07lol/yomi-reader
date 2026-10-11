import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentRevision, CommunityComment } from '../community';

const mocks = vi.hoisted(() => ({
  listCommentRevisions: vi.fn(async () => [] as CommentRevision[]),
}));

vi.mock('../community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../community')>();
  return { ...actual, listCommentRevisions: mocks.listCommentRevisions };
});

const { CommentThread } = await import('./CommentThread');

function comment(overrides: Partial<CommunityComment> = {}): CommunityComment {
  return {
    id: 'c1',
    authorId: 'u1',
    novelId: 'novel-1',
    chapterId: null,
    kind: 'comment',
    body: 'Current text.',
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

const ctx = {
  scope: { novelId: 'novel-1', chapterId: null },
  currentUserId: 'u1',
  moderator: false,
  onChanged: () => {},
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  mocks.listCommentRevisions.mockReset();
  mocks.listCommentRevisions.mockResolvedValue([]);
});

describe('CommentThread edit history', () => {
  it('shows no edit control for an unedited comment', () => {
    const thread = new CommentThread(comment(), ctx);
    expect(thread.element.querySelector('.community-edit-toggle')).toBeNull();
  });

  it('reveals lazily-loaded history when the edited marker is clicked', async () => {
    mocks.listCommentRevisions.mockResolvedValue([
      { id: '1', commentId: 'c1', previousBody: 'Original text.', revisedAt: '2026-01-01T00:00:00Z' },
    ]);
    const thread = new CommentThread(
      comment({ updatedAt: '2026-01-02T00:00:00Z' }),
      ctx,
    );
    document.body.appendChild(thread.element);

    const toggle = thread.element.querySelector<HTMLElement>('.community-edit-toggle');
    expect(toggle).not.toBeNull();
    expect(mocks.listCommentRevisions).not.toHaveBeenCalled();

    toggle?.click();
    await flush();

    expect(mocks.listCommentRevisions).toHaveBeenCalledWith('c1');
    const history = thread.element.querySelector<HTMLElement>('.community-edit-history');
    expect(history?.hidden).toBe(false);
    expect(history?.textContent).toContain('Original text.');
    expect(history?.textContent).toContain('Current version');
    expect(history?.textContent).toContain('Current text.');
    thread.dispose();
  });

  it('renders revision bodies as inert text, never HTML', async () => {
    const payload = '<img src=x onerror="window.__xss=1">';
    mocks.listCommentRevisions.mockResolvedValue([
      { id: '1', commentId: 'c1', previousBody: payload, revisedAt: '2026-01-01T00:00:00Z' },
    ]);
    const thread = new CommentThread(comment({ updatedAt: '2026-01-02T00:00:00Z' }), ctx);
    document.body.appendChild(thread.element);
    thread.element.querySelector<HTMLElement>('.community-edit-toggle')?.click();
    await flush();

    expect(thread.element.querySelector('.community-edit-history img')).toBeNull();
    expect(thread.element.querySelector('.community-edit-history-body')?.textContent).toBe(payload);
    thread.dispose();
  });

  it('collapses the history again on a second click', async () => {
    const thread = new CommentThread(comment({ updatedAt: '2026-01-02T00:00:00Z' }), ctx);
    document.body.appendChild(thread.element);
    const toggle = thread.element.querySelector<HTMLElement>('.community-edit-toggle');
    toggle?.click();
    await flush();
    expect(thread.element.querySelector<HTMLElement>('.community-edit-history')?.hidden).toBe(false);
    toggle?.click();
    expect(thread.element.querySelector<HTMLElement>('.community-edit-history')?.hidden).toBe(true);
    thread.dispose();
  });
});
