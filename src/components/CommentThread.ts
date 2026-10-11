/* ─── Comment thread item ───
   Renders one comment/review and its controls. Bodies are always inserted as
   text, never HTML, so user content can never execute. */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import {
  REPORT_REASONS,
  deleteComment,
  editComment,
  getSession,
  listCommentRevisions,
  listReplies,
  reportComment,
  setCommentVisibility,
  toggleLike,
} from '../community';
import type { CommentRevision, CommunityComment, DiscussionScope, ReportReason } from '../community';
import { openAccountDialog } from './AuthDialog';
import { CommentComposer } from './CommentComposer';
import { confirmDestructive, renderAvatar, renderMentionBody } from './community-shared';

export interface CommentThreadContext {
  scope: DiscussionScope;
  currentUserId: string | null;
  moderator: boolean;
  onChanged: () => void;
}

const isReplyMarker = '[deleted]';

export class CommentThread {
  readonly element: HTMLElement;
  private comment: CommunityComment;
  private readonly ctx: CommentThreadContext;
  private readonly isReply: boolean;

  private readonly headerHost: HTMLElement;
  private readonly bodyHost: HTMLElement;
  private readonly actionsHost: HTMLElement;
  private readonly replyHost: HTMLElement;
  private readonly historyHost: HTMLElement;
  private readonly notice: HTMLElement;
  private replyComposer: CommentComposer | null = null;
  private historyOpen = false;
  private historyLoaded = false;
  private readonly revisions: CommentRevision[] = [];
  private repliesLoaded = false;
  private repliesOffset = 0;
  private busy = false;

  constructor(comment: CommunityComment, ctx: CommentThreadContext, options: { isReply?: boolean } = {}) {
    this.comment = comment;
    this.ctx = ctx;
    this.isReply = Boolean(options.isReply);

    this.headerHost = el('div', { className: 'community-comment-header' });
    this.bodyHost = el('div', { className: 'community-comment-content' });
    this.actionsHost = el('div', { className: 'community-comment-actions' });
    this.replyHost = el('div', { className: 'community-replies' });
    this.historyHost = el('div', { className: 'community-edit-history', hidden: true });
    this.notice = el('p', { className: 'community-notice', role: 'status', 'aria-live': 'polite' });

    this.element = el('article', {
      className: `community-comment${this.isReply ? ' community-comment-reply' : ''}`,
      'data-comment-id': comment.id,
    }, this.headerHost, this.bodyHost, this.actionsHost, this.notice, this.historyHost, this.replyHost);

    this.render();
  }

  update(comment: CommunityComment): void {
    this.comment = comment;
    this.render();
  }

  dispose(): void {
    this.replyComposer?.dispose();
    this.element.remove();
  }

  private setNotice(type: 'error' | 'success', text: string): void {
    this.notice.className = `community-notice community-notice-${type}`;
    this.notice.textContent = text;
  }

  private render(): void {
    this.renderHeader();
    this.renderBody();
    this.renderActions();
  }

  private renderHeader(): void {
    empty(this.headerHost);
    const author = this.comment.author;
    const name = author?.username ?? 'reader';
    const statusBadge = this.comment.status === 'hidden'
      ? el('span', { className: 'community-badge community-badge-hidden', text: 'hidden' })
      : null;

    this.headerHost.appendChild(renderAvatar(author));
    const authorEl = author
      ? el('button', {
          className: 'community-comment-author community-author-link',
          type: 'button',
          text: name,
          title: `View ${name}'s profile`,
          onclick: () => router.navigate(`user/${encodeURIComponent(author.username)}`),
        })
      : el('span', { className: 'community-comment-author', text: name });
    this.headerHost.appendChild(el('div', { className: 'community-comment-meta' },
      authorEl,
      el('time', {
        className: 'community-comment-time',
        datetime: this.comment.createdAt,
        title: formatAbsoluteTime(this.comment.createdAt),
        text: formatRelativeTime(this.comment.createdAt),
      }),
      this.isEdited
        ? el('button', {
            className: 'community-comment-edited community-edit-toggle',
            type: 'button',
            'aria-expanded': String(this.historyOpen),
            title: `Edited ${formatAbsoluteTime(this.comment.updatedAt)}`,
            text: 'edited',
            onclick: () => void this.toggleHistory(),
          })
        : null,
      statusBadge,
    ));

    if (this.comment.kind === 'review') {
      this.headerHost.appendChild(el('span', {
        className: 'community-review-badge',
        text: this.comment.rating !== null ? `Review · ${'★'.repeat(this.comment.rating)}${'☆'.repeat(5 - this.comment.rating)}` : 'Review',
      }));
    }
  }

  private renderBody(): void {
    empty(this.bodyHost);
    const deleted = this.comment.status === 'deleted';
    const body = el('p', {
      className: `community-comment-body${deleted ? ' community-comment-body-deleted' : ''}`,
    });
    // Deleted comments show only the marker; live bodies link @mentions.
    if (deleted) body.appendChild(document.createTextNode(isReplyMarker));
    else body.appendChild(renderMentionBody(this.comment.body));
    this.bodyHost.appendChild(body);
  }

  private renderActions(): void {
    empty(this.actionsHost);
    const isAuthor = this.ctx.currentUserId !== null && this.ctx.currentUserId === this.comment.authorId;

    const likeBtn = el('button', {
      className: `community-action community-like${this.comment.likedByMe ? ' is-liked' : ''}`,
      type: 'button',
      'aria-pressed': String(this.comment.likedByMe),
      'aria-label': this.comment.likedByMe ? 'Unlike this comment' : 'Like this comment',
    },
      el('span', { className: 'community-like-icon', 'aria-hidden': 'true', text: this.comment.likedByMe ? '♥' : '♡' }),
      el('span', { className: 'community-like-count', text: String(this.comment.likeCount) }),
    );
    likeBtn.addEventListener('click', () => void this.toggleLike());
    if (this.comment.status === 'deleted') likeBtn.disabled = true;
    this.actionsHost.appendChild(likeBtn);

    if (!this.isReply && this.comment.status !== 'deleted') {
      this.actionsHost.appendChild(el('button', {
        className: 'community-action',
        type: 'button',
        text: 'Reply',
        onclick: () => this.toggleReplyComposer(),
      }));
    }

    if (this.comment.status !== 'deleted' && this.repliesLoaded === false && this.comment.replyCount > 0) {
      this.actionsHost.appendChild(el('button', {
        className: 'community-action community-action-muted',
        type: 'button',
        text: `${this.comment.replyCount} ${this.comment.replyCount === 1 ? 'reply' : 'replies'}`,
        onclick: () => void this.loadReplies(),
      }));
    }

    if (isAuthor && this.comment.status === 'visible') {
      this.actionsHost.appendChild(el('button', {
        className: 'community-action',
        type: 'button',
        text: 'Edit',
        onclick: () => this.startEdit(),
      }));
      this.actionsHost.appendChild(el('button', {
        className: 'community-action community-action-danger',
        type: 'button',
        text: 'Delete',
        onclick: () => void this.remove(),
      }));
    }

    if (!isAuthor && this.comment.status === 'visible') {
      this.actionsHost.appendChild(el('button', {
        className: 'community-action community-action-muted',
        type: 'button',
        text: 'Report',
        onclick: () => this.startReport(),
      }));
    }

    if (this.ctx.moderator && (this.comment.status === 'visible' || this.comment.status === 'hidden')) {
      this.actionsHost.appendChild(el('button', {
        className: 'community-action community-action-muted',
        type: 'button',
        text: this.comment.status === 'hidden' ? 'Restore' : 'Hide',
        onclick: () => void this.toggleVisibility(),
      }));
    }
  }

  private get isEdited(): boolean {
    return this.comment.status !== 'deleted' && this.comment.updatedAt !== this.comment.createdAt;
  }

  private async toggleHistory(): Promise<void> {
    this.historyOpen = !this.historyOpen;
    if (!this.historyOpen) {
      this.historyHost.hidden = true;
      this.renderHeader();
      return;
    }
    this.historyHost.hidden = false;
    if (!this.historyLoaded) {
      empty(this.historyHost);
      this.historyHost.appendChild(el('p', { className: 'community-edit-history-loading', text: 'Loading edit history…' }));
      try {
        const revisions = await listCommentRevisions(this.comment.id);
        this.revisions.splice(0, this.revisions.length, ...revisions);
      } catch {
        // Treated as "no history visible to you".
      }
      this.historyLoaded = true;
    }
    this.renderHistory();
    this.renderHeader();
  }

  private renderHistory(): void {
    empty(this.historyHost);
    this.historyHost.appendChild(el('h4', { className: 'community-edit-history-title', text: 'Edit history' }));

    if (this.revisions.length === 0) {
      this.historyHost.appendChild(el('p', {
        className: 'community-edit-history-empty',
        text: 'Earlier versions are not available to you.',
      }));
    } else {
      for (const revision of this.revisions) {
        this.historyHost.appendChild(el('div', { className: 'community-edit-history-item' },
          el('time', {
            className: 'community-edit-history-time',
            datetime: revision.revisedAt,
            title: formatAbsoluteTime(revision.revisedAt),
            text: formatRelativeTime(revision.revisedAt),
          }),
          el('p', { className: 'community-edit-history-body', text: revision.previousBody }),
        ));
      }
    }

    this.historyHost.appendChild(el('div', { className: 'community-edit-history-item community-edit-history-current' },
      el('span', { className: 'community-edit-history-time', text: 'Current version' }),
      el('p', { className: 'community-edit-history-body', text: this.comment.body }),
    ));
  }

  private async toggleLike(): Promise<void> {
    if (this.busy) return;
    const session = await getSession();
    if (!session) {
      openAccountDialog('sign-in');
      return;
    }
    this.busy = true;
    // Optimistic, with a full rollback on any failure.
    const wasLiked = this.comment.likedByMe;
    const previousCount = this.comment.likeCount;
    this.comment.likedByMe = !wasLiked;
    this.comment.likeCount = Math.max(0, previousCount + (wasLiked ? -1 : 1));
    this.renderActions();

    try {
      await toggleLike(this.comment.id, this.comment.likedByMe);
      this.ctx.onChanged();
    } catch (error) {
      this.comment.likedByMe = wasLiked;
      this.comment.likeCount = previousCount;
      this.renderActions();
      this.setNotice('error', error instanceof Error ? error.message : 'Could not update your like.');
    } finally {
      this.busy = false;
    }
  }

  private toggleReplyComposer(): void {
    if (this.replyComposer) {
      this.replyComposer.dispose();
      this.replyComposer = null;
      return;
    }
    this.replyComposer = new CommentComposer({
      scope: this.ctx.scope,
      parentId: this.comment.id,
      compact: true,
      submitLabel: 'Reply',
      onPosted: (reply) => {
        this.replyComposer?.dispose();
        this.replyComposer = null;
        this.comment.replyCount += 1;
        this.appendReply(reply);
        this.renderActions();
        this.ctx.onChanged();
      },
      onCancel: () => {
        this.replyComposer?.dispose();
        this.replyComposer = null;
      },
    });
    this.replyHost.appendChild(this.replyComposer.element);
    this.replyComposer.element.querySelector('textarea')?.focus();
  }

  private appendReply(reply: CommunityComment): void {
    const thread = new CommentThread(reply, this.ctx, { isReply: true });
    const emptyState = this.replyHost.querySelector('.community-replies-empty');
    if (emptyState) emptyState.remove();
    this.replyHost.appendChild(thread.element);
    this.repliesLoaded = true;
  }

  private async loadReplies(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const page = await listReplies(this.comment.id, 0);
      this.repliesOffset = page.nextOffset;
      this.repliesLoaded = true;
      for (const reply of page.comments) this.appendReply(reply);
      if (page.comments.length === 0) {
        this.replyHost.appendChild(el('p', { className: 'community-replies-empty', text: 'No replies yet.' }));
      } else if (page.hasMore) {
        this.replyHost.appendChild(el('button', {
          className: 'community-action community-action-muted',
          type: 'button',
          text: 'Load more replies',
          onclick: (event: Event) => void this.loadMoreReplies(event.currentTarget as HTMLButtonElement),
        }));
      }
      this.renderActions();
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Replies could not be loaded.');
    } finally {
      this.busy = false;
    }
  }

  private async loadMoreReplies(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const page = await listReplies(this.comment.id, this.repliesOffset);
      this.repliesOffset = page.nextOffset;
      for (const reply of page.comments) this.appendReply(reply);
      if (!page.hasMore) button.remove();
      else button.disabled = false;
    } catch (error) {
      button.disabled = false;
      this.setNotice('error', error instanceof Error ? error.message : 'Replies could not be loaded.');
    }
  }

  private startEdit(): void {
    empty(this.bodyHost);
    const textarea = el('textarea', {
      className: 'community-textarea community-textarea-compact',
      rows: '3',
      'aria-label': 'Edit your comment',
      value: this.comment.body,
    });
    const save = el('button', {
      className: 'community-button community-button-primary',
      type: 'button',
      text: 'Save',
      onclick: () => void this.saveEdit(textarea.value),
    });
    const cancel = el('button', {
      className: 'community-button community-button-ghost',
      type: 'button',
      text: 'Cancel',
      onclick: () => this.renderBody(),
    });
    this.bodyHost.appendChild(textarea);
    this.bodyHost.appendChild(el('div', { className: 'community-composer-actions' }, save, cancel));
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  private async saveEdit(body: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const updated = await editComment(this.comment.id, body);
      this.comment = {
        ...this.comment,
        body: updated.body,
        status: updated.status,
        updatedAt: updated.updatedAt,
      };
      this.render();
      this.setNotice('success', 'Comment updated.');
      this.ctx.onChanged();
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Your edit could not be saved.');
    } finally {
      this.busy = false;
    }
  }

  private startReport(): void {
    if (this.element.querySelector('.community-report-form')) return;
    const reason = el('select', { className: 'community-select', 'aria-label': 'Reason for reporting' },
      ...REPORT_REASONS.map((option) => el('option', { value: option.value, text: option.label })),
    );
    const details = el('textarea', {
      className: 'community-textarea community-textarea-compact',
      rows: '2',
      maxlength: '500',
      placeholder: 'Add details (optional)',
      'aria-label': 'Report details',
    });
    const form = el('div', { className: 'community-report-form' },
      reason,
      details,
      el('div', { className: 'community-composer-actions' },
        el('button', {
          className: 'community-button community-button-ghost',
          type: 'button',
          text: 'Cancel',
          onclick: () => form.remove(),
        }),
        el('button', {
          className: 'community-button community-button-primary',
          type: 'button',
          text: 'Submit report',
          onclick: () => void this.submitReport(reason.value as ReportReason, details.value, form),
        }),
      ),
    );
    this.bodyHost.appendChild(form);
  }

  private async submitReport(reason: ReportReason, details: string, form: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await reportComment(this.comment.id, reason, details);
      form.remove();
      this.setNotice('success', 'Thanks — a moderator will review this report.');
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Your report could not be sent.');
    } finally {
      this.busy = false;
    }
  }

  private async remove(): Promise<void> {
    if (!confirmDestructive('Delete this comment? Replies stay visible.')) return;
    if (this.busy) return;
    this.busy = true;
    try {
      await deleteComment(this.comment.id);
      this.comment = { ...this.comment, status: 'deleted', body: isReplyMarker };
      this.render();
      this.ctx.onChanged();
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Your comment could not be deleted.');
    } finally {
      this.busy = false;
    }
  }

  private async toggleVisibility(): Promise<void> {
    if (this.busy) return;
    const next = this.comment.status === 'hidden' ? 'visible' : 'hidden';
    if (next === 'hidden' && !confirmDestructive('Hide this comment from readers?')) return;
    this.busy = true;
    try {
      await setCommentVisibility(this.comment.id, next);
      this.comment = { ...this.comment, status: next };
      this.render();
      this.setNotice('success', next === 'hidden' ? 'Comment hidden.' : 'Comment restored.');
      this.ctx.onChanged();
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'The moderation action failed.');
    } finally {
      this.busy = false;
    }
  }
}
