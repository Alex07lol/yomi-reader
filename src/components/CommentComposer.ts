/* ─── Comment composer ───
   Used for root comments/reviews and for replies. Posts are always sent as
   plain text; the database re-validates length and scope. */

import { el, empty } from '../utils/dom';
import { createComment, getSession, MAX_COMMENT_LENGTH } from '../community';
import type { CommentKind, CommunityComment, DiscussionScope } from '../community';
import { openAccountDialog } from './AuthDialog';

export interface CommentComposerOptions {
  scope: DiscussionScope;
  parentId?: string | null;
  /** Novel-level root posts may be posted as a rated review. */
  allowReview?: boolean;
  placeholder?: string;
  submitLabel?: string;
  compact?: boolean;
  onPosted?: (comment: CommunityComment) => void;
  onCancel?: () => void;
}

export class CommentComposer {
  readonly element: HTMLElement;
  private readonly options: CommentComposerOptions;
  private readonly textarea: HTMLTextAreaElement;
  private readonly counter: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly submitBtn: HTMLButtonElement;
  private kindField: HTMLElement | null = null;
  private ratingField: HTMLElement | null = null;
  private kindInput: HTMLSelectElement | null = null;
  private ratingInput: HTMLSelectElement | null = null;
  private busy = false;

  constructor(options: CommentComposerOptions) {
    this.options = options;
    const isReply = Boolean(options.parentId);

    this.textarea = el('textarea', {
      className: `community-textarea${options.compact ? ' community-textarea-compact' : ''}`,
      rows: options.compact ? '2' : '3',
      maxlength: String(MAX_COMMENT_LENGTH),
      placeholder: options.placeholder ?? (isReply ? 'Write a reply…' : 'Share your thoughts…'),
      'aria-label': isReply ? 'Write a reply' : 'Write a comment',
    });
    this.counter = el('span', { className: 'community-counter', 'aria-live': 'off', text: `0 / ${MAX_COMMENT_LENGTH}` });
    this.notice = el('p', { className: 'community-notice', role: 'status', 'aria-live': 'polite' });

    this.submitBtn = el('button', {
      className: 'community-button community-button-primary',
      type: 'button',
      text: options.submitLabel ?? (isReply ? 'Reply' : 'Post comment'),
      onclick: () => void this.submit(),
    });

    const actions = el('div', { className: 'community-composer-actions' },
      this.counter,
      options.onCancel ? el('button', {
        className: 'community-button community-button-ghost',
        type: 'button',
        text: 'Cancel',
        onclick: () => options.onCancel?.(),
      }) : null,
      this.submitBtn,
    );

    const children: (Node | null)[] = [];
    if (options.allowReview && !isReply) {
      this.kindInput = el('select', {
        className: 'community-select',
        'aria-label': 'Post type',
        onchange: () => this.syncKind(),
      },
        el('option', { value: 'comment', text: 'Comment' }),
        el('option', { value: 'review', text: 'Review' }),
      );
      this.kindField = el('div', { className: 'community-composer-field' },
        el('label', { className: 'community-field-label', text: 'Post as' }),
        this.kindInput,
      );

      this.ratingInput = el('select', {
        className: 'community-select',
        'aria-label': 'Rating',
      },
        el('option', { value: '', text: 'No rating' }),
        ...[1, 2, 3, 4, 5].map((n) => el('option', { value: String(n), text: `${n} ★` })),
      );
      this.ratingField = el('div', { className: 'community-composer-field' },
        el('label', { className: 'community-field-label', text: 'Rating' }),
        this.ratingInput,
      );
      children.push(el('div', { className: 'community-composer-meta' }, this.kindField, this.ratingField));
    }

    children.push(this.textarea, actions, this.notice);

    this.element = el('form', { className: 'community-composer' }, ...children);
    this.element.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.textarea.addEventListener('input', () => this.updateCounter());
    this.element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' && ((event as KeyboardEvent).ctrlKey || (event as KeyboardEvent).metaKey)) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.syncKind();
  }

  private syncKind(): void {
    const isReview = this.kindInput?.value === 'review';
    if (this.ratingField) this.ratingField.hidden = !isReview;
    if (this.submitBtn) this.submitBtn.textContent = isReview ? 'Post review' : 'Post comment';
  }

  private updateCounter(): void {
    this.counter.textContent = `${this.textarea.value.length} / ${MAX_COMMENT_LENGTH}`;
    this.counter.classList.toggle('community-counter-warn', this.textarea.value.length > MAX_COMMENT_LENGTH * 0.9);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.submitBtn.disabled = busy;
    this.submitBtn.setAttribute('aria-busy', String(busy));
    this.submitBtn.textContent = busy
      ? 'Posting…'
      : (this.kindInput?.value === 'review' ? 'Post review' : (this.options.parentId ? 'Reply' : 'Post comment'));
  }

  private setNotice(type: 'error' | 'success', text: string): void {
    empty(this.notice);
    this.notice.className = `community-notice community-notice-${type}`;
    this.notice.setAttribute('role', type === 'error' ? 'alert' : 'status');
    this.notice.textContent = text;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const body = this.textarea.value;
    if (!body.trim()) {
      this.setNotice('error', 'Write something before posting.');
      this.textarea.focus();
      return;
    }

    const session = await getSession();
    if (!session) {
      this.setNotice('error', 'Sign in to join the discussion.');
      openAccountDialog('sign-in');
      return;
    }

    const kind: CommentKind = this.kindInput?.value === 'review' ? 'review' : 'comment';
    const ratingValue = this.ratingInput?.value;
    const rating = kind === 'review' && ratingValue ? Number(ratingValue) : null;

    this.setBusy(true);
    this.setNotice('success', '');
    try {
      const comment = await createComment(this.options.scope, body, {
        kind,
        rating,
        parentId: this.options.parentId ?? null,
      });
      this.textarea.value = '';
      this.updateCounter();
      if (this.kindInput) {
        this.kindInput.value = 'comment';
        if (this.ratingInput) this.ratingInput.value = '';
        this.syncKind();
      }
      this.setNotice('success', this.options.parentId ? 'Reply posted.' : 'Posted.');
      this.options.onPosted?.(comment);
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Your comment could not be posted.');
    } finally {
      this.setBusy(false);
    }
  }

  refreshSignedInState(): void {
    void getSession().then((session) => {
      this.textarea.disabled = false;
      this.submitBtn.disabled = this.busy;
      this.element.classList.toggle('community-composer-signed-out', !session);
    });
  }

  dispose(): void {
    this.element.remove();
  }
}
