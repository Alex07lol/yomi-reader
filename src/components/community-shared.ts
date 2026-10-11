/* ─── Shared community UI atoms ─── */

import { el } from '../utils/dom';
import { router } from '../utils/router';
import { avatarUrl } from '../community';
import { tokenizeMentions } from '../community/mentions';

export interface AvatarLike {
  username: string;
  avatarPath: string | null;
}

export function initialsOf(username: string): string {
  return (username || 'reader').slice(0, 2).toUpperCase();
}

export function renderAvatar(profile: AvatarLike | null, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const url = avatarUrl(profile?.avatarPath ?? null);
  if (url) {
    return el('span', { className: `community-avatar community-avatar-${size}` },
      el('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    );
  }
  return el('span', {
    className: `community-avatar community-avatar-${size} community-avatar-fallback`,
    'aria-hidden': 'true',
    text: initialsOf(profile?.username ?? 'reader'),
  });
}

export function confirmDestructive(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm(message);
}

/**
 * Renders a comment body with `@username` tokens as buttons that open the
 * mentioned reader's public profile (`#user/<username>`). Built from DOM nodes,
 * never innerHTML, so a body can never inject markup.
 */
export function renderMentionBody(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const token of tokenizeMentions(text)) {
    if (token.type === 'text') {
      fragment.appendChild(document.createTextNode(token.value));
      continue;
    }
    fragment.appendChild(el('button', {
      className: 'community-mention',
      type: 'button',
      text: token.value,
      title: `View @${token.username}'s profile`,
      onclick: () => router.navigate(`user/${encodeURIComponent(token.username)}`),
    }));
  }
  return fragment;
}
