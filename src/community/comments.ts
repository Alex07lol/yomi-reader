/* ─── Comment data service ───
   Scoped, paginated reads and owner-checked writes. The database is the
   authority for authorization; the validation here only gives fast feedback.

   Every request is keyed by stable novel/chapter IDs. Threads from different
   novels or chapters can never blend because `chapter_id IS NULL` and
   `chapter_id = '<id>'` are distinct queries. */

import { getCommunityClient, requireCommunityClient } from './supabase';
import type {
  CommentKind,
  CommentRevision,
  CommentOrder,
  CommentPage,
  CommunityComment,
  CreateCommentOptions,
  DiscussionScope,
  ModerationReport,
  ReportPage,
  ReportReason,
  CommentVisibility,
} from './types';
import { COMMUNITY_PAGE_SIZE, MAX_COMMENT_LENGTH, MAX_DETAILS_LENGTH } from './types';

export class CommunityError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'CommunityError';
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

const COMMENT_SELECT = [
  'id',
  'author_id',
  'novel_id',
  'chapter_id',
  'kind',
  'body',
  'rating',
  'parent_id',
  'status',
  'created_at',
  'updated_at',
  'author:profiles!comments_author_id_fkey(id,username,avatar_path)',
  'likes:comment_likes(count)',
].join(',');

interface CommentRow {
  id: string;
  author_id: string;
  novel_id: string;
  chapter_id: string | null;
  kind: string;
  body: string;
  rating: number | null;
  parent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  author: { id: string; username: string; avatar_path: string | null } | null;
  likes: { count: number }[] | null;
}

/* ── Pure helpers (unit-tested without a network) ── */

export function scopeKey(scope: DiscussionScope): string {
  return `${scope.novelId}::${scope.chapterId ?? ''}`;
}

export function validateScope(scope: DiscussionScope | null | undefined): string | null {
  if (!scope || typeof scope.novelId !== 'string' || !ID_PATTERN.test(scope.novelId)) {
    return 'This discussion is not linked to a valid novel.';
  }
  if (scope.chapterId !== null && (typeof scope.chapterId !== 'string' || !ID_PATTERN.test(scope.chapterId))) {
    return 'This discussion is not linked to a valid chapter.';
  }
  return null;
}

export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}

export function validateBody(body: string): string | null {
  const normalized = normalizeBody(body);
  if (!normalized) return 'Write something before posting.';
  if (normalized.length > MAX_COMMENT_LENGTH) return `Comments can be at most ${MAX_COMMENT_LENGTH} characters.`;
  return null;
}

/** Merges pages without duplicating rows by ID, preserving existing order. */
export function mergeUniqueComments(existing: CommunityComment[], incoming: CommunityComment[]): CommunityComment[] {
  const seen = new Set(existing.map((comment) => comment.id));
  const merged = [...existing];
  for (const comment of incoming) {
    if (!seen.has(comment.id)) {
      seen.add(comment.id);
      merged.push(comment);
    }
  }
  return merged;
}

export function mapCommentRow(row: CommentRow): CommunityComment {
  const likeCount = Array.isArray(row.likes) && row.likes.length > 0 && typeof row.likes[0]?.count === 'number'
    ? Number(row.likes[0].count)
    : 0;
  return {
    id: row.id,
    authorId: row.author_id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    kind: row.kind === 'review' ? 'review' : 'comment',
    body: row.body,
    rating: typeof row.rating === 'number' ? row.rating : null,
    parentId: row.parent_id,
    status: row.status === 'hidden' || row.status === 'deleted' ? row.status : 'visible',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.author
      ? { id: row.author.id, username: row.author.username, avatarPath: row.author.avatar_path }
      : null,
    likeCount,
    likedByMe: false,
    replyCount: 0,
  };
}

function toCommunityError(error: unknown): CommunityError {
  if (error instanceof CommunityError) return error;
  const message = (error as { message?: string } | null)?.message ?? 'Something went wrong. Please try again.';
  const code = (error as { code?: string } | null)?.code ?? null;
  if (/permission denied/i.test(message)) {
    return new CommunityError('You do not have permission to do that.', code);
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return new CommunityError('You appear to be offline. Check your connection and try again.', code);
  }
  return new CommunityError(message, code);
}

/* ── In-flight request de-duplication ── */

const inflight = new Map<string, Promise<unknown>>();

function dedupeRequest<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = work().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

/** Called after auth changes so viewer-specific fields are refetched. */
export function clearCommunityCache(): void {
  inflight.clear();
}

async function viewerId(): Promise<string | null> {
  const client = await getCommunityClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user?.id ?? null;
}

/* ── Reads ── */

async function hydrateViewerFields(comments: CommunityComment[]): Promise<void> {
  if (comments.length === 0) return;
  const client = await getCommunityClient();
  if (!client) return;
  const ids = comments.map((comment) => comment.id);

  try {
    const { data, error } = await client
      .from('comments')
      .select('parent_id')
      .in('parent_id', ids)
      .eq('status', 'visible');
    if (!error && Array.isArray(data)) {
      const counts = new Map<string, number>();
      for (const row of data as { parent_id: string | null }[]) {
        if (row.parent_id) counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1);
      }
      for (const comment of comments) comment.replyCount = counts.get(comment.id) ?? 0;
    }
  } catch {
    // Reply counts are decorative; never fail a page because of them.
  }

  const uid = await viewerId();
  if (!uid) return;
  try {
    const { data, error } = await client
      .from('comment_likes')
      .select('comment_id')
      .in('comment_id', ids)
      .eq('user_id', uid);
    if (!error && Array.isArray(data)) {
      const liked = new Set((data as { comment_id: string }[]).map((row) => row.comment_id));
      for (const comment of comments) comment.likedByMe = liked.has(comment.id);
    }
  } catch {
    // Like state is cosmetic on read; writes still enforce ownership.
  }
}

function applyScopeFilter(query: any, scope: DiscussionScope): any {
  const scoped = query.eq('novel_id', scope.novelId);
  return scope.chapterId === null ? scoped.is('chapter_id', null) : scoped.eq('chapter_id', scope.chapterId);
}

export async function listComments(
  scope: DiscussionScope,
  order: CommentOrder = 'newest',
  offset = 0,
  options: { kind?: CommentKind | 'all' } = {},
): Promise<CommentPage> {
  const scopeError = validateScope(scope);
  if (scopeError) throw new CommunityError(scopeError);

  const kind = options.kind ?? 'all';
  const key = `list:${scopeKey(scope)}:${order}:${offset}:${kind}`;

  return dedupeRequest(key, async () => {
    const client = await requireCommunityClient();
    const ascending = order === 'oldest';
    let query = client
      .from('comments')
      .select(COMMENT_SELECT, { count: 'exact' })
      .is('parent_id', null);
    query = applyScopeFilter(query, scope);
    if (kind !== 'all') query = query.eq('kind', kind);
    query = query
      .order('created_at', { ascending })
      .order('id', { ascending })
      .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) throw toCommunityError(error);

    const rows = (data ?? []) as unknown as CommentRow[];
    const comments = rows.map((row) => mapCommentRow(row));
    await hydrateViewerFields(comments);

    const total = typeof count === 'number' ? count : comments.length;
    const nextOffset = offset + comments.length;
    return { comments, total, nextOffset, hasMore: nextOffset < total };
  });
}

export async function listReplies(parentId: string, offset = 0): Promise<CommentPage> {
  const key = `replies:${parentId}:${offset}`;
  return dedupeRequest(key, async () => {
    const client = await requireCommunityClient();
    const { data, error, count } = await client
      .from('comments')
      .select(COMMENT_SELECT, { count: 'exact' })
      .eq('parent_id', parentId)
      .eq('status', 'visible')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);
    if (error) throw toCommunityError(error);

    const rows = (data ?? []) as unknown as CommentRow[];
    const comments = rows.map((row) => mapCommentRow(row));
    await hydrateViewerFields(comments);

    const total = typeof count === 'number' ? count : comments.length;
    const nextOffset = offset + comments.length;
    return { comments, total, nextOffset, hasMore: nextOffset < total };
  });
}

export async function getCommentCount(scope: DiscussionScope): Promise<number> {
  const scopeError = validateScope(scope);
  if (scopeError) throw new CommunityError(scopeError);

  const key = `count:${scopeKey(scope)}`;
  return dedupeRequest(key, async () => {
    const client = await requireCommunityClient();
    let query = client
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'visible')
      .is('parent_id', null);
    query = applyScopeFilter(query, scope);
    const { count, error } = await query;
    if (error) throw toCommunityError(error);
    return typeof count === 'number' ? count : 0;
  });
}

/* ── Writes (all authorization is re-checked by RLS + triggers) ── */

export async function createComment(
  scope: DiscussionScope,
  body: string,
  options: CreateCommentOptions = {},
): Promise<CommunityComment> {
  const scopeError = validateScope(scope);
  if (scopeError) throw new CommunityError(scopeError);
  const bodyError = validateBody(body);
  if (bodyError) throw new CommunityError(bodyError);

  const kind: CommentKind = options.parentId ? 'comment' : (options.kind ?? 'comment');
  let rating: number | null = null;
  if (kind === 'review') {
    if (scope.chapterId !== null) throw new CommunityError('Reviews can only be posted on a novel.');
    rating = options.rating ?? null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new CommunityError('Choose a rating between 1 and 5 stars.');
    }
  }

  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new CommunityError('Please sign in to post.');

  const { data, error } = await client
    .from('comments')
    .insert({
      author_id: userData.user.id,
      novel_id: scope.novelId,
      chapter_id: scope.chapterId,
      kind,
      body: normalizeBody(body),
      rating,
      parent_id: options.parentId ?? null,
    })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw toCommunityError(error);

  const comment = mapCommentRow(data as unknown as CommentRow);
  await hydrateViewerFields([comment]);
  return comment;
}

export async function editComment(commentId: string, body: string): Promise<CommunityComment> {
  const bodyError = validateBody(body);
  if (bodyError) throw new CommunityError(bodyError);

  const client = await requireCommunityClient();
  const { data, error } = await client
    .from('comments')
    .update({ body: normalizeBody(body) })
    .eq('id', commentId)
    .select(COMMENT_SELECT)
    .single();
  if (error) throw toCommunityError(error);
  if (!data) throw new CommunityError('This comment is no longer editable.');

  const comment = mapCommentRow(data as unknown as CommentRow);
  await hydrateViewerFields([comment]);
  return comment;
}

/** Owner-checked soft delete. Replies and ancestry are preserved. */
export async function deleteComment(commentId: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.rpc('delete_own_comment', { p_comment_id: commentId });
  if (error) throw toCommunityError(error);
}

export async function toggleLike(commentId: string, liked: boolean): Promise<void> {
  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new CommunityError('Please sign in to like comments.');

  if (liked) {
    const { error } = await client
      .from('comment_likes')
      .insert({ comment_id: commentId, user_id: userData.user.id });
    // A concurrent duplicate like is already the desired state.
    if (error && error.code !== '23505') throw toCommunityError(error);
  } else {
    const { error } = await client
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userData.user.id);
    if (error) throw toCommunityError(error);
  }
}

export async function reportComment(commentId: string, reason: ReportReason, details = ''): Promise<void> {
  const trimmed = details.trim();
  if (trimmed.length > MAX_DETAILS_LENGTH) {
    throw new CommunityError(`Details can be at most ${MAX_DETAILS_LENGTH} characters.`);
  }

  const client = await requireCommunityClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new CommunityError('Please sign in to report a comment.');

  const { error } = await client.from('comment_reports').insert({
    comment_id: commentId,
    reporter_id: userData.user.id,
    reason,
    details: trimmed || null,
  });
  if (error) throw toCommunityError(error);
}

/* ── Moderation ── */

export async function setCommentVisibility(commentId: string, visibility: CommentVisibility): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.rpc('set_comment_visibility', {
    p_comment_id: commentId,
    p_visibility: visibility,
  });
  if (error) throw toCommunityError(error);
}

export async function setUserRestriction(userId: string, active: boolean, reason: string, hours = 72): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.rpc('set_user_restriction', {
    p_user_id: userId,
    p_active: active,
    p_reason: reason,
    p_hours: hours,
  });
  if (error) throw toCommunityError(error);
}

interface ReportRow {
  id: string;
  comment_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reporter: { id: string; username: string } | null;
  comment: {
    id: string;
    body: string;
    status: string;
    author_id: string;
    novel_id: string;
    chapter_id: string | null;
    author: { id: string; username: string } | null;
  } | null;
}

const REPORT_SELECT = [
  'id',
  'comment_id',
  'reporter_id',
  'reason',
  'details',
  'status',
  'created_at',
  'reviewed_at',
  'reporter:profiles!comment_reports_reporter_id_fkey(id,username)',
  'comment:comments!comment_reports_comment_id_fkey(id,body,status,author_id,novel_id,chapter_id,author:profiles!comments_author_id_fkey(id,username))',
].join(',');

export async function listPendingReports(offset = 0, status: ReportPage['reports'][number]['status'] | 'pending' = 'pending'): Promise<ReportPage> {
  const client = await requireCommunityClient();
  const { data, error, count } = await client
    .from('comment_reports')
    .select(REPORT_SELECT, { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: true })
    .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);
  if (error) throw toCommunityError(error);

  const rows = (data ?? []) as unknown as ReportRow[];
  const reports: ModerationReport[] = rows.map((row) => ({
    id: row.id,
    commentId: row.comment_id,
    reporterId: row.reporter_id,
    reporterUsername: row.reporter?.username ?? 'reader',
    reason: row.reason as ReportReason,
    details: row.details,
    status: row.status === 'dismissed' || row.status === 'actioned' ? row.status : 'pending',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    commentBody: row.comment?.body ?? '[removed]',
    commentStatus: row.comment?.status === 'hidden' || row.comment?.status === 'deleted'
      ? row.comment.status
      : 'visible',
    commentAuthorId: row.comment?.author_id ?? '',
    commentAuthorUsername: row.comment?.author?.username ?? 'reader',
    novelId: row.comment?.novel_id ?? '',
    chapterId: row.comment?.chapter_id ?? null,
  }));

  const nextOffset = offset + reports.length;
  const total = typeof count === 'number' ? count : reports.length;
  return { reports, nextOffset, hasMore: nextOffset < total };
}

export async function reviewReport(reportId: string, status: 'dismissed' | 'actioned'): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.from('comment_reports').update({ status }).eq('id', reportId);
  if (error) throw toCommunityError(error);
}

/** Public activity feed for one profile: their visible top-level posts. */
export async function listUserComments(userId: string, offset = 0): Promise<CommentPage> {
  const key = `user-comments:${userId}:${offset}`;
  return dedupeRequest(key, async () => {
    const client = await requireCommunityClient();
    const { data, error, count } = await client
      .from('comments')
      .select(COMMENT_SELECT, { count: 'exact' })
      .eq('author_id', userId)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);
    if (error) throw toCommunityError(error);

    const rows = (data ?? []) as unknown as CommentRow[];
    const comments = rows.map((row) => mapCommentRow(row));
    await hydrateViewerFields(comments);

    const total = typeof count === 'number' ? count : comments.length;
    const nextOffset = offset + comments.length;
    return { comments, total, nextOffset, hasMore: nextOffset < total };
  });
}

/**
 * Edit history for a comment, oldest first. Only the author and moderators can
 * read it (Row Level Security); other readers simply receive an empty list.
 */
export async function listCommentRevisions(commentId: string): Promise<CommentRevision[]> {
  const client = await getCommunityClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('comment_revisions')
      .select('id,comment_id,previous_body,revised_at')
      .eq('comment_id', commentId)
      .order('revised_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as { id: string | number; comment_id: string; previous_body: string; revised_at: string }[])
      .map((row) => ({
        id: String(row.id),
        commentId: row.comment_id,
        previousBody: row.previous_body,
        revisedAt: row.revised_at,
      }));
  } catch {
    // History is an optional enhancement; never fail a thread over it.
    return [];
  }
}
