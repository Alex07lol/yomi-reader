/* ─── Account dialog ───
   Sign in, register, email verification, password reset/recovery and profile
   editing in one accessible modal. Uses the native <dialog> element for focus
   management and Escape handling. */

import { el, empty } from '../utils/dom';
import {
  getMyProfile,
  getOAuthProviders,
  OAUTH_PROVIDER_LABELS,
  signInWithOAuth,
  MAX_AVATAR_BYTES,
  removeAvatar,
  resendConfirmation,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  updatePassword,
  updateUsername,
  uploadAvatar,
  validateEmail,
  validatePassword,
  validateUsername,
} from '../community';
import { avatarUrl } from '../community';

export type AccountDialogMode = 'sign-in' | 'sign-up' | 'verify' | 'reset' | 'recovery' | 'profile';

function field(labelText: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = `account-field-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  (input as HTMLInputElement).setAttribute('aria-describedby', hint ? `${id}-hint` : '');
  return el('div', { className: 'community-field' },
    el('label', { className: 'community-field-label', for: id, text: labelText }),
    input,
    hint ? el('p', { className: 'community-field-hint', id: `${id}-hint`, text: hint }) : null,
  );
}

export class AuthDialog {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private mode: AccountDialogMode = 'sign-in';
  private notice: { type: 'error' | 'success'; text: string } | null = null;
  private pendingEmail = '';
  private busy = false;

  constructor() {
    this.body = el('div', { className: 'community-dialog-body' });
    this.dialog = el('dialog', { className: 'community-dialog', 'aria-label': 'Yomi account' },
      el('div', { className: 'community-dialog-inner' },
        el('button', {
          className: 'community-dialog-close',
          type: 'button',
          'aria-label': 'Close',
          text: '✕',
          onclick: () => this.close(),
        }),
        this.body,
      ),
    );
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog.addEventListener('close', () => {
      this.notice = null;
      this.busy = false;
    });
  }

  open(mode: AccountDialogMode = 'sign-in'): void {
    this.mode = mode;
    this.notice = null;
    if (!this.dialog.isConnected) document.body.appendChild(this.dialog);
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  showNotice(type: 'error' | 'success', text: string): void {
    this.notice = { type, text };
    this.render();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  private setNotice(type: 'error' | 'success', text: string): void {
    this.notice = { type, text };
  }

  private async guard(work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await work();
    } catch (error) {
      this.setNotice('error', error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      this.setBusy(false);
    }
  }

  private render(): void {
    empty(this.body);

    const heading = document.createElement('h2');
    heading.className = 'community-dialog-title';
    heading.textContent = {
      'sign-in': 'Sign in',
      'sign-up': 'Create an account',
      verify: 'Check your email',
      reset: 'Reset your password',
      recovery: 'Choose a new password',
      profile: 'Your profile',
    }[this.mode];
    this.body.appendChild(heading);

    if (this.mode !== 'profile') {
      this.body.appendChild(el('p', {
        className: 'community-dialog-subtitle',
        text: 'An account is only needed to join discussions. Reading is always free.',
      }));
    }

    if (this.notice) {
      this.body.appendChild(el('p', {
        className: `community-notice community-notice-${this.notice.type}`,
        role: this.notice.type === 'error' ? 'alert' : 'status',
        'aria-live': 'polite',
        text: this.notice.text,
      }));
    }

    switch (this.mode) {
      case 'sign-in': this.renderSignIn(); break;
      case 'sign-up': this.renderSignUp(); break;
      case 'verify': this.renderVerify(); break;
      case 'reset': this.renderReset(); break;
      case 'recovery': this.renderRecovery(); break;
      case 'profile': this.renderProfile(); break;
    }
  }

  private submitButton(label: string, onClick: () => void): HTMLElement {
    return el('button', {
      className: 'community-button community-button-primary',
      type: 'submit',
      disabled: this.busy,
      'aria-busy': String(this.busy),
      text: this.busy ? 'Please wait…' : label,
      onclick: (event: Event) => {
        event.preventDefault();
        onClick();
      },
    });
  }

  private linkButton(label: string, onClick: () => void): HTMLElement {
    return el('button', {
      className: 'community-link-button',
      type: 'button',
      text: label,
      onclick: onClick,
    });
  }

  private renderSignIn(): void {
    const email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password' });
    this.body.appendChild(field('Email', email));
    this.body.appendChild(field('Password', password));
    this.body.appendChild(this.submitButton('Sign in', () => void this.guard(async () => {
      const emailError = validateEmail(email.value);
      if (emailError) throw new Error(emailError);
      if (!password.value) throw new Error('Enter your password.');
      await signIn(email.value, password.value);
      this.notice = { type: 'success', text: 'Signed in.' };
      this.close();
    })));

    this.body.appendChild(el('div', { className: 'community-dialog-links' },
      this.linkButton('Create an account', () => this.open('sign-up')),
      this.linkButton('Forgot password?', () => this.open('reset')),
    ));
    const oauth = this.renderOAuth();
    if (oauth) this.body.appendChild(oauth);
  }

  private renderSignUp(): void {
    const username = el('input', { type: 'text', autocomplete: 'username', placeholder: 'reader_name' });
    const email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    const password = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    this.body.appendChild(field('Username', username, '3–24 characters: lowercase letters, numbers, underscores.'));
    this.body.appendChild(field('Email', email));
    this.body.appendChild(field('Password', password));
    this.body.appendChild(this.submitButton('Create account', () => void this.guard(async () => {
      const usernameError = validateUsername(username.value);
      if (usernameError) throw new Error(usernameError);
      const emailError = validateEmail(email.value);
      if (emailError) throw new Error(emailError);
      const passwordError = validatePassword(password.value);
      if (passwordError) throw new Error(passwordError);

      const result = await signUp({ email: email.value, password: password.value, username: username.value });
      this.pendingEmail = email.value.trim();
      if (result.needsEmailConfirmation) {
        this.open('verify');
        this.setNotice('success', 'Almost there — confirm your email to finish.');
      } else {
        this.setNotice('success', 'Welcome to Yomi.');
        this.close();
      }
    })));

    this.body.appendChild(el('div', { className: 'community-dialog-links' },
      this.linkButton('Already have an account?', () => this.open('sign-in')),
    ));
    const oauth = this.renderOAuth();
    if (oauth) this.body.appendChild(oauth);
  }

  private renderVerify(): void {
    this.body.appendChild(el('p', {
      className: 'community-dialog-text',
      text: `We sent a confirmation link to ${this.pendingEmail || 'your email'}. Open it to activate your account.`,
    }));
    this.body.appendChild(this.submitButton('Resend email', () => void this.guard(async () => {
      if (!this.pendingEmail) throw new Error('Sign up first to resend the confirmation.');
      await resendConfirmation(this.pendingEmail);
      this.setNotice('success', 'Confirmation email sent again.');
    })));
    this.body.appendChild(el('div', { className: 'community-dialog-links' },
      this.linkButton('Back to sign in', () => this.open('sign-in')),
    ));
  }

  private renderReset(): void {
    const email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    this.body.appendChild(field('Email', email));
    this.body.appendChild(this.submitButton('Send reset link', () => void this.guard(async () => {
      const emailError = validateEmail(email.value);
      if (emailError) throw new Error(emailError);
      await sendPasswordReset(email.value);
      this.setNotice('success', 'If that email has an account, a reset link is on its way.');
    })));
    this.body.appendChild(el('div', { className: 'community-dialog-links' },
      this.linkButton('Back to sign in', () => this.open('sign-in')),
    ));
  }

  private renderRecovery(): void {
    const password = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password' });
    const confirm = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    this.body.appendChild(field('New password', password));
    this.body.appendChild(field('Confirm password', confirm));
    this.body.appendChild(this.submitButton('Update password', () => void this.guard(async () => {
      const passwordError = validatePassword(password.value);
      if (passwordError) throw new Error(passwordError);
      if (password.value !== confirm.value) throw new Error('The passwords do not match.');
      await updatePassword(password.value);
      this.setNotice('success', 'Your password has been updated.');
      this.close();
    })));
  }

  /** Social sign-in buttons. Only rendered for providers the deployment enables. */
  private renderOAuth(): HTMLElement | null {
    const providers = getOAuthProviders();
    if (providers.length === 0) return null;
    return el('div', { className: 'community-oauth' },
      el('div', { className: 'community-oauth-divider' },
        el('span', { text: 'or continue with' }),
      ),
      el('div', { className: 'community-oauth-buttons' },
        ...providers.map((provider) => el('button', {
          className: 'community-button community-oauth-button',
          type: 'button',
          disabled: this.busy,
          text: OAUTH_PROVIDER_LABELS[provider],
          onclick: () => void this.guard(async () => {
            // On success the browser leaves the page for the provider.
            await signInWithOAuth(provider);
          }),
        })),
      ),
    );
  }

  private renderProfile(): void {
    const username = el('input', { type: 'text', autocomplete: 'username', placeholder: 'reader_name' });
    const file = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      'aria-label': 'Choose an avatar image',
    });
    const preview = el('div', { className: 'community-avatar-preview', 'aria-hidden': 'true' });
    const showAvatar = async (): Promise<void> => {
      const profile = await getMyProfile();
      empty(preview);
      const url = avatarUrl(profile?.avatarPath ?? null);
      if (url) preview.appendChild(el('img', { src: url, alt: '' }));
      else preview.appendChild(el('span', { text: 'No avatar' }));
    };

    this.body.appendChild(el('div', { className: 'community-profile-row' },
      preview,
      el('div', { className: 'community-profile-fields' },
        field('Username', username, '3–24 characters: lowercase letters, numbers, underscores.'),
        field('Avatar', file, `PNG, JPEG or WebP up to ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB.`),
      ),
    ));

    this.body.appendChild(this.submitButton('Save profile', () => void this.guard(async () => {
      const usernameError = validateUsername(username.value);
      if (usernameError) throw new Error(usernameError);
      await updateUsername(username.value);
      const selected = file.files?.[0];
      if (selected) await uploadAvatar(selected);
      await showAvatar();
      this.setNotice('success', 'Profile updated.');
    })));

    this.body.appendChild(el('div', { className: 'community-dialog-links' },
      this.linkButton('Remove avatar', () => void this.guard(async () => {
        await removeAvatar();
        await showAvatar();
        this.setNotice('success', 'Avatar removed.');
      })),
      this.linkButton('Sign out', () => void this.guard(async () => {
        await signOut();
        this.close();
      })),
    ));

    void (async () => {
      const profile = await getMyProfile();
      username.value = profile?.username ?? '';
      await showAvatar();
    })();
  }
}

let instance: AuthDialog | null = null;

export function openAccountDialog(mode: AccountDialogMode = 'sign-in'): void {
  if (!instance) instance = new AuthDialog();
  instance.open(mode);
}
