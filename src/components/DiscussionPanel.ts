/* ─── Discussion panel ───
   A self-contained, lazily-loaded comment list for one discussion scope.
   It never loads until opened, is safe to dispose, and degrades gracefully
   when the community service is unavailable. */

import { el, empty } from '../utils/dom';
import {
  clearCommunityCache,
  formatRating,
  getCommentCount,
  getNovelRating,
  getRatingDistribution,
  getSession,
  isCommunityConfigured,
  isModerator,
  listComments,
  mergeUniqueComments,
  onCommunityEvent,
  roundedStars,
} from '../community';
import type { CommentKind, CommentOrder, CommunityComment, DiscussionScope } from '../community';
import { CommentComposer } from './CommentComposer';
import { CommentThread } from './CommentThread';
import { openAccountDialog } from './AuthDialog';

export interface DiscussionPanelOptions {
  scope: DiscussionScope;
  title?: string;
  allowReviews?: boolean;
  compact?: boolean;
  collapsible?: boolean;
  startOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export class DiscussionPanel {
  readonly element: HTMLElement;
  private readonly options: DiscussionPanelOptions;
  private readonly ratingHost: HTMLElement;
  private readonly headerHost: HTMLElement;
  private readonly composerHost: HTMLElement;
  private readonly listHost: HTMLElement;
  private readonly footerHost: HTMLElement;
  private readonly statusHost: HTMLElement;

  private open_ = false;
  private loaded = false;
  private loading = false;
  private order: CommentOrder = 'newest';
  private kind: CommentKind | 'all' = 'all';
  private comments: CommunityComment[] = [];
  private threads = new Map<string, CommentThread>();
  private nextOffset = 0;
  private hasMore = false;
  private total = 0;
  private error: string | null = null;
  private currentUserId: string | null = null;
  private moderator = false;
  private unsubscribe: (() => void) | null = null;
  private composer: CommentComposer | null = null;
  private ratingLoaded = false;

  constructor(options: DiscussionPanelOptions) {
    this.options = options;
    this.ratingHost = el('div', { className: 'community-rating-summary' });
    this.headerHost = el('div', { className: 'community-panel-header' });
    this.composerHost = el('div', { className: 'community-panel-composer' });
    this.listHost = el('div', { className: 'community-list' });
    this.footerHost = el('div', { className: 'community-panel-footer' });
    this.statusHost = el('div', { className: 'community-panel-status', role: 'status', 'aria-live': 'polite' });

    this.element = el('section', {
      className: `community-panel${options.compact ? ' community-panel-compact' : ''}`,
      'data-scope': `${options.scope.novelId}::${options.scope.chapterId ?? ''}`,
      'aria-label': options.title ?? 'Discussion',
    }, this.ratingHost, this.headerHost, this.composerHost, this.listHost, this.footerHost, this.statusHost);

    this.renderHeader();
    this.renderStatus();

    this.unsubscribe = onCommunityEvent(() => {
      clearCommunityCache();
      void this.refreshViewer();
    });

    if (options.startOpen) this.open();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  get count(): number {
    return this.total;
  }

  /** Loads the thread the first time it becomes visible. */
  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.element.classList.add('community-panel-open');
    this.options.onOpenChange?.(true);
    if (!this.loaded && !this.loading) void this.loadFirstPage();
    if (!this.ratingLoaded) void this.loadRatingSummary();
    void this.refreshViewer();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.element.classList.remove('community-panel-open');
    this.options.onOpenChange?.(false);
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** Refetches the first page, preserving sort/filter. */
  refresh(): void {
    if (!this.loaded && !this.open_) return;
    void this.loadFirstPage();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const thread of this.threads.values()) thread.dispose();
    this.threads.clear();
    this.composer?.dispose();
    this.composer = null;
    this.element.remove();
  }

  private async refreshViewer(): Promise<void> {
    const session = await getSession();
    const nextId = session?.user?.id ?? null;
    const nextModerator = nextId ? await isModerator() : false;
    const changed = nextId !== this.currentUserId || nextModerator !== this.moderator;
    this.currentUserId = nextId;
    this.moderator = nextModerator;
    this.renderComposer();
    this.renderStatus();
    if (changed && this.loaded) this.renderList();
  }

  private async loadFirstPage(): Promise<void> {
    if (!isCommunityConfigured()) {
      this.error = null;
      this.loaded = false;
      this.renderStatus();
      return;
    }
    this.loading = true;
    this.error = null;
    this.renderStatus();
    try {
      const page = await listComments(this.options.scope, this.order, 0, { kind: this.kind });
      this.comments = page.comments;
      this.total = page.total;
      this.nextOffset = page.nextOffset;
      this.hasMore = page.hasMore;
      this.loaded = true;
      this.renderList();
      this.renderFooter();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The discussion could not be loaded.';
    } finally {
      this.loading = false;
      this.renderStatus();
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.renderFooter();
    try {
      const page = await listComments(this.options.scope, this.order, this.nextOffset, { kind: this.kind });
      this.comments = mergeUniqueComments(this.comments, page.comments);
      this.total = page.total;
      this.nextOffset = page.nextOffset;
      this.hasMore = page.hasMore;
      this.renderList();
      this.renderFooter();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'More comments could not be loaded.';
      this.renderStatus();
    } finally {
      this.loading = false;
      this.renderFooter();
    }
  }

  private renderHeader(): void {
    empty(this.headerHost);

    const title = el('div', { className: 'community-panel-title-group' },
      el('h3', { className: 'community-panel-title', text: this.options.title ?? 'Discussion' }),
      el('span', { className: 'community-panel-count', text: this.total > 0 ? String(this.total) : '' }),
    );
    this.headerHost.appendChild(title);

    const controls = el('div', { className: 'community-panel-controls' });

    if (this.options.allowReviews) {
      const filter = el('select', {
        className: 'community-select community-select-sm',
        'aria-label': 'Filter discussion',
        onchange: (event: Event) => {
          this.kind = (event.target as HTMLSelectElement).value as CommentKind | 'all';
          void this.loadFirstPage();
        },
      },
        el('option', { value: 'all', text: 'All' }),
        el('option', { value: 'review', text: 'Reviews' }),
        el('option', { value: 'comment', text: 'Comments' }),
      );
      controls.appendChild(filter);
    }

    const sort = el('select', {
      className: 'community-select community-select-sm',
      'aria-label': 'Sort comments',
      onchange: (event: Event) => {
        this.order = (event.target as HTMLSelectElement).value === 'oldest' ? 'oldest' : 'newest';
        void this.loadFirstPage();
      },
    },
      el('option', { value: 'newest', text: 'Newest' }),
      el('option', { value: 'oldest', text: 'Oldest' }),
    );
    controls.appendChild(sort);

    if (this.options.collapsible) {
      controls.appendChild(el('button', {
        className: 'community-button community-button-ghost community-panel-toggle',
        type: 'button',
        text: this.open_ ? 'Hide' : 'Show',
        onclick: () => this.toggle(),
      }));
    }

    this.headerHost.appendChild(controls);
  }

  private renderComposer(): void {
    empty(this.composerHost);

    if (!isCommunityConfigured()) return;

    if (!this.currentUserId) {
      this.composerHost.appendChild(el('div', { className: 'community-signin-prompt' },
        el('p', { text: 'Sign in to join the discussion. Reading stays account-free.' }),
        el('button', {
          className: 'community-button community-button-primary',
          type: 'button',
          text: 'Sign in',
          onclick: () => openAccountDialog('sign-in'),
        }),
      ));
      return;
    }

    this.composer?.dispose();
    this.composer = new CommentComposer({
      scope: this.options.scope,
      allowReview: this.options.allowReviews,
      submitLabel: this.options.allowReviews ? 'Post' : 'Post comment',
      onPosted: (comment) => {
        // New comments sort to the top of "newest" and the bottom of "oldest".
        this.comments = this.order === 'newest'
          ? [comment, ...this.comments]
          : [...this.comments, comment];
        this.total += 1;
        this.nextOffset += 1;
        this.renderList();
        this.renderFooter();
        this.renderStatus();
        if (comment.kind === 'review') void this.loadRatingSummary();
      },
    });
    this.composerHost.appendChild(this.composer.element);
  }

  private renderList(): void {
    for (const thread of this.threads.values()) thread.dispose();
    this.threads.clear();
    empty(this.listHost);
    if (!isCommunityConfigured()) return;

    if (this.error) {
      this.listHost.appendChild(el('div', { className: 'community-empty community-empty-error' },
        el('p', { text: this.error }),
        el('button', {
          className: 'community-button community-button-ghost',
          type: 'button',
          text: 'Try again',
          onclick: () => void this.loadFirstPage(),
        }),
      ));
      return;
    }

    if (this.comments.length === 0) {
      this.listHost.appendChild(el('p', {
        className: 'community-empty',
        text: this.kind === 'review' ? 'No reviews yet. Be the first.' : 'No comments yet. Start the conversation.',
      }));
      return;
    }

    const ctx = {
      scope: this.options.scope,
      currentUserId: this.currentUserId,
      moderator: this.moderator,
      onChanged: () => this.renderStatus(),
    };

    for (const comment of this.comments) {
      const thread = new CommentThread(comment, ctx);
      this.threads.set(comment.id, thread);
      this.listHost.appendChild(thread.element);
    }
  }

  private renderFooter(): void {
    empty(this.footerHost);
    if (this.error || !this.hasMore) return;
    this.footerHost.appendChild(el('button', {
      className: 'community-button community-button-ghost community-load-more',
      type: 'button',
      disabled: this.loading,
      'aria-busy': String(this.loading),
      text: this.loading ? 'Loading…' : 'Load more comments',
      onclick: () => void this.loadMore(),
    }));
  }

  private renderStatus(): void {
    empty(this.statusHost);
    this.renderHeader();
    if (this.loading && !this.loaded) {
      this.statusHost.appendChild(el('div', { className: 'community-skeleton', 'aria-hidden': 'true' },
        el('span', { className: 'community-skeleton-row' }),
        el('span', { className: 'community-skeleton-row' }),
        el('span', { className: 'community-skeleton-row' }),
      ));
      return;
    }
    if (!isCommunityConfigured()) {
      this.statusHost.appendChild(el('p', {
        className: 'community-empty',
        text: 'Community discussions are not configured for this deployment.',
      }));
      return;
    }
    if (!this.open_) return;
    const count = this.total;
    this.statusHost.appendChild(el('span', {
      className: 'sr-only',
      text: count === 1 ? '1 comment loaded' : `${count} comments loaded`,
    }));
  }

  private async loadRatingSummary(): Promise<void> {
    if (!this.options.allowReviews || !isCommunityConfigured()) return;
    this.ratingLoaded = true;
    const novelId = this.options.scope.novelId;
    const [rating, distribution] = await Promise.all([
      getNovelRating(novelId),
      getRatingDistribution(novelId),
    ]);
    empty(this.ratingHost);
    if (rating.count === 0 || rating.average === null) {
      this.ratingHost.hidden = true;
      return;
    }
    this.ratingHost.hidden = false;

    const stars = roundedStars(rating.average);
    this.ratingHost.appendChild(el('div', { className: 'community-rating-average' },
      el('span', { className: 'community-rating-score', text: formatRating(rating.average) }),
      el('span', {
        className: 'community-rating-stars',
        'aria-hidden': 'true',
        text: '★'.repeat(stars) + '☆'.repeat(5 - stars),
      }),
      el('span', {
        className: 'community-rating-total',
        text: `${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`,
      }),
    ));

    const bars = el('div', { className: 'community-rating-bars' });
    for (let star = 5; star >= 1; star--) {
      const bucket = distribution.find((entry) => entry.stars === star);
      const count = bucket?.count ?? 0;
      const pct = rating.count > 0 ? Math.round((count / rating.count) * 100) : 0;
      bars.appendChild(el('div', { className: 'community-rating-bar-row' },
        el('span', { className: 'community-rating-bar-label', text: `${star}★` }),
        el('span', { className: 'community-rating-bar-track' },
          el('span', { className: 'community-rating-bar-fill', style: `width: ${pct}%` }),
        ),
        el('span', { className: 'community-rating-bar-count', text: String(count) }),
      ));
    }
    this.ratingHost.appendChild(bars);
  }

  async loadCount(): Promise<number> {
    try {
      this.total = await getCommentCount(this.options.scope);
      this.renderHeader();
      return this.total;
    } catch {
      return 0;
    }
  }
}
