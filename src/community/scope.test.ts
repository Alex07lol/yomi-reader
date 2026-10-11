import { describe, expect, it } from 'vitest';
import {
  mapCommentRow,
  mergeUniqueComments,
  normalizeBody,
  scopeKey,
  validateBody,
  validateScope,
} from './comments';
import type { CommunityComment, DiscussionScope } from './types';

const novelScope: DiscussionScope = { novelId: 'omniscient-readers-viewpoint', chapterId: null };
const chapterScope: DiscussionScope = { novelId: 'omniscient-readers-viewpoint', chapterId: 'orv-0001' };

describe('discussion scope', () => {
  it('accepts stable novel and chapter identifiers', () => {
    expect(validateScope(novelScope)).toBeNull();
    expect(validateScope(chapterScope)).toBeNull();
  });

  it('rejects missing or malformed identifiers', () => {
    expect(validateScope({ novelId: '', chapterId: null })).not.toBeNull();
    expect(validateScope({ novelId: '../etc/passwd', chapterId: null })).not.toBeNull();
    expect(validateScope({ novelId: 'ok-novel', chapterId: 'bad/../id' })).not.toBeNull();
    expect(validateScope(null)).not.toBeNull();
  });

  it('keeps novel-level and chapter-level scopes distinct', () => {
    expect(scopeKey(novelScope)).not.toEqual(scopeKey(chapterScope));
    expect(scopeKey(chapterScope)).toContain('orv-0001');
  });

  it('keeps the same chapter id under different novels separate', () => {
    const a = scopeKey({ novelId: 'novel-a', chapterId: 'chapter-1' });
    const b = scopeKey({ novelId: 'novel-b', chapterId: 'chapter-1' });
    expect(a).not.toEqual(b);
  });
});

describe('comment bodies', () => {
  it('trims and normalizes line endings', () => {
    expect(normalizeBody('  hello\r\nworld  ')).toBe('hello\nworld');
  });

  it('rejects empty and over-long bodies', () => {
    expect(validateBody('   ')).not.toBeNull();
    expect(validateBody('x'.repeat(4001))).not.toBeNull();
    expect(validateBody('a valid comment')).toBeNull();
  });
});

describe('mergeUniqueComments', () => {
  const comment = (id: string): CommunityComment => ({
    id,
    authorId: 'u1',
    novelId: 'n',
    chapterId: null,
    kind: 'comment',
    body: id,
    rating: null,
    parentId: null,
    status: 'visible',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: null,
    likeCount: 0,
    likedByMe: false,
    replyCount: 0,
  });

  it('never renders the same comment twice', () => {
    const merged = mergeUniqueComments([comment('a'), comment('b')], [comment('b'), comment('c')]);
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('mapCommentRow', () => {
  it('reads embedded like counts and rejects unknown statuses', () => {
    const mapped = mapCommentRow({
      id: 'c1',
      author_id: 'u1',
      novel_id: 'n1',
      chapter_id: 'ch1',
      kind: 'comment',
      body: 'hello',
      rating: null,
      parent_id: null,
      status: 'weird',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      author: { id: 'u1', username: 'reader', avatar_path: null },
      likes: [{ count: 4 }],
    });
    expect(mapped.likeCount).toBe(4);
    expect(mapped.status).toBe('visible');
    expect(mapped.author?.username).toBe('reader');
  });
});
