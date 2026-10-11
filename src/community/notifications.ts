/* ─── Notification inbox service ───
   A strictly per-recipient inbox for replies, @mentions and upvotes. The
   database writes every row from SECURITY DEFINER triggers, so this module only
   reads the signed-in user's own rows and marks them as read. */

import { getCommunityClient, requireCommunityClient } from './supabase';
import { COMMUNITY_PAGE_SIZE } from './types';
import type { CommunityAuthor, CommunityNotification, NotificationPage } from './types';

export const NOTIFICATION_LABELS: Record<CommunityNotification['kind'], string> = {
  reply: 'replied to your comment',
  mention: 'mentioned you',
  like: 'upvoted your comment',
};

const NOTIFICATION_SELECT = [
  'id',
  'kind',
  'novel_id',
  'chapter_id',
  'comment_id',
  'created_at',
  'read_at',
  'actor:profiles!notifications_actor_id_fkey(id,username,avatar_path)',
  'comment:comments!notifications_comment_id_fkey(body,status)',
].join(',');

interface NotificationRow {
  id: string | number;
  kind: string;
  novel_id: string;
  chapter_id: string | null;
  comment_id: string | null;
  created_at: string;
  read_at: string | null;
  actor: { id: string; username: string; avatar_path: string | null } | null;
  comment: { body: string; status: string } | null;
}

const PREVIEW_LIMIT = 120;

/**
 * The in-app route a notification points at. Chapter activity opens the reader
 * at that chapter; novel-level activity opens the novel page. Pure so it can be
 * unit tested without a network.
 */
export function notificationTargetPath(notification: Pick<CommunityNotification, 'novelId' | 'chapterId'>): string {
  const novelId = encodeURIComponent(notification.novelId);
  return notification.chapterId
    ? `reader/${novelId}/${encodeURIComponent(notification.chapterId)}`
    : `novel/${novelId}`;
}

export function notificationPreview(body: string | null): string | null {
  if (!body) return null;
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT - 1)}…` : collapsed;
}

export function mapNotificationRow(row: NotificationRow): CommunityNotification {
  const actor: CommunityAuthor | null = row.actor
    ? { id: row.actor.id, username: row.actor.username, avatarPath: row.actor.avatar_path }
    : null;
  const kind = row.kind === 'reply' || row.kind === 'mention' || row.kind === 'like' ? row.kind : 'reply';
  return {
    id: String(row.id),
    kind,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    commentId: row.comment_id,
    createdAt: row.created_at,
    readAt: row.read_at,
    actor,
    preview: notificationPreview(row.comment?.body ?? null),
  };
}

function toError(error: unknown): Error {
  const message = (error as { message?: string } | null)?.message ?? 'Notifications are unavailable right now.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return new Error('You appear to be offline. Check your connection and try again.');
  }
  return new Error(message);
}

/** Descending by recency. Returns an empty page when the community is off. */
export async function listNotifications(offset = 0): Promise<NotificationPage> {
  const client = await getCommunityClient();
  const empty: NotificationPage = { notifications: [], total: 0, nextOffset: 0, hasMore: false };
  if (!client) return empty;

  const { data, error, count } = await client
    .from('notifications')
    .select(NOTIFICATION_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + COMMUNITY_PAGE_SIZE - 1);
  if (error) throw toError(error);

  const rows = (data ?? []) as unknown as NotificationRow[];
  const notifications = rows.map(mapNotificationRow);
  const total = typeof count === 'number' ? count : notifications.length;
  const nextOffset = offset + notifications.length;
  return { notifications, total, nextOffset, hasMore: nextOffset < total };
}

/** Unread count for the navbar badge. Returns 0 on any failure. */
export async function getUnreadNotificationCount(): Promise<number> {
  const client = await getCommunityClient();
  if (!client) return 0;
  try {
    const { count, error } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);
  if (error) throw toError(error);
}

/** Marks every unread notification read. Returns how many rows changed. */
export async function markAllNotificationsRead(): Promise<number> {
  const client = await requireCommunityClient();
  const { data, error } = await client.rpc('mark_all_notifications_read');
  if (error) throw toError(error);
  return typeof data === 'number' ? data : 0;
}
