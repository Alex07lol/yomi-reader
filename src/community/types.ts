/* ─── Community domain types ─── */

export type CommentKind = 'comment' | 'review';
export type CommentStatus = 'visible' | 'hidden' | 'deleted';
export type CommentOrder = 'newest' | 'oldest';
export type ReportReason = 'spam' | 'abuse' | 'harassment' | 'spoiler' | 'off-topic' | 'other';
export type ReportStatus = 'pending' | 'dismissed' | 'actioned';
export type CommentVisibility = 'visible' | 'hidden';

/** A discussion is always identified by stable novel/chapter IDs, never titles. */
export interface DiscussionScope {
  novelId: string;
  /** `null` means the novel-level discussion. */
  chapterId: string | null;
}

export interface CommunityAuthor {
  id: string;
  username: string;
  avatarPath: string | null;
}

export interface CommunityComment {
  id: string;
  authorId: string;
  novelId: string;
  chapterId: string | null;
  kind: CommentKind;
  body: string;
  rating: number | null;
  parentId: string | null;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
  author: CommunityAuthor | null;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
}

export interface CommentPage {
  comments: CommunityComment[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
}

export interface CreateCommentOptions {
  kind?: CommentKind;
  rating?: number | null;
  parentId?: string | null;
}

export interface CommunityProfile {
  id: string;
  username: string;
  avatarPath: string | null;
  createdAt: string;
}

export interface ModerationReport {
  id: string;
  commentId: string;
  reporterId: string;
  reporterUsername: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  commentBody: string;
  commentStatus: CommentStatus;
  commentAuthorId: string;
  commentAuthorUsername: string;
  novelId: string;
  chapterId: string | null;
}

export interface ReportPage {
  reports: ModerationReport[];
  nextOffset: number;
  hasMore: boolean;
}

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'abuse', label: 'Abusive content' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'spoiler', label: 'Unmarked spoilers' },
  { value: 'off-topic', label: 'Off-topic' },
  { value: 'other', label: 'Something else' },
];

export const COMMUNITY_PAGE_SIZE = 20;
export const MAX_COMMENT_LENGTH = 4000;
export const MAX_DETAILS_LENGTH = 500;

/* ── Ratings & public profiles ── */

/** Aggregated review rating for one novel. `null` average means no reviews. */
export interface NovelRating {
  novelId: string;
  average: number | null;
  count: number;
}

export interface NovelRatingDistribution {
  novelId: string;
  stars: number;
  count: number;
}

/** Visible activity counts for a public profile. */
export interface ProfileActivitySummary {
  userId: string;
  chapterCommentCount: number;
  novelCommentCount: number;
  reviewCount: number;
  likesReceived: number;
}

/** One prior version of an edited comment, visible to its author and moderators. */
export interface CommentRevision {
  id: string;
  commentId: string;
  previousBody: string;
  revisedAt: string;
}

/* ── Notifications ── */

export type NotificationKind = 'reply' | 'mention' | 'like';

export interface CommunityNotification {
  id: string;
  kind: NotificationKind;
  novelId: string;
  chapterId: string | null;
  commentId: string | null;
  createdAt: string;
  readAt: string | null;
  actor: CommunityAuthor | null;
  preview: string | null;
}

export interface NotificationPage {
  notifications: CommunityNotification[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
}
