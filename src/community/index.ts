export type {
  CommentKind,
  CommentOrder,
  CommentPage,
  CommentStatus,
  CommentVisibility,
  CommentRevision,
  CommunityAuthor,
  CommunityComment,
  CommunityProfile,
  CreateCommentOptions,
  DiscussionScope,
  ModerationReport,
  ReportPage,
  ReportReason,
  ReportStatus,
  NovelRating,
  NovelRatingDistribution,
  NotificationKind,
  NotificationPage,
  CommunityNotification,
  ProfileActivitySummary,
} from './types';
export { COMMUNITY_PAGE_SIZE, MAX_COMMENT_LENGTH, MAX_DETAILS_LENGTH, REPORT_REASONS } from './types';

export {
  CommunityUnavailableError,
  getCommunityAvailability,
  getCommunityClient,
  getCommunityClientSync,
  getCommunityPublicUrl,
  isAuthCallbackUrl,
  isCommunityConfigured,
  requireCommunityClient,
} from './supabase';
export type { CommunityAvailability } from './supabase';

export {
  clearRatingCache,
  formatRating,
  getCachedNovelRating,
  getNovelRating,
  getRatingDistribution,
  loadNovelRatings,
  roundedStars,
} from './ratings';

export { pushShelfChange, syncShelvesWithAccount } from './shelves';

export { emitCommunityEvent, onCommunityEvent } from './events';
export type { CommunityEvent } from './events';

export {
  OAUTH_PROVIDER_LABELS,
  getCurrentUser,
  getOAuthProviders,
  getSession,
  isModerator,
  mapAuthError,
  normalizeUsername,
  resendConfirmation,
  sendPasswordReset,
  signIn,
  signInWithOAuth,
  signOut,
  signUp,
  updatePassword,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyEmailToken,
} from './auth';
export type { OAuthProvider } from './auth';

export {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  avatarUrl,
  getMyProfile,
  getProfile,
  getProfileByUsername,
  getProfileStats,
  removeAvatar,
  updateUsername,
  uploadAvatar,
} from './profiles';

export {
  CommunityError,
  clearCommunityCache,
  createComment,
  deleteComment,
  editComment,
  getCommentCount,
  listCommentRevisions,
  listComments,
  listPendingReports,
  listUserComments,
  listReplies,
  mapCommentRow,
  mergeUniqueComments,
  normalizeBody,
  reportComment,
  reviewReport,
  scopeKey,
  setCommentVisibility,
  setUserRestriction,
  toggleLike,
  validateBody,
  validateScope,
} from './comments';

export {
  NOTIFICATION_LABELS,
  getUnreadNotificationCount,
  listNotifications,
  mapNotificationRow,
  markAllNotificationsRead,
  markNotificationRead,
  notificationPreview,
  notificationTargetPath,
} from './notifications';
