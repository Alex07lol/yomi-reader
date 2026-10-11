/* ─── Compact navbar account menu ───
   Shows sign-in/create-account when signed out, and avatar + username with a
   small menu when signed in. One shared event subscription re-paints every
   mounted menu, so navigating between pages never leaks listeners. */

import { el, empty } from '../utils/dom';
import {
  avatarUrl,
  getCurrentUser,
  getMyProfile,
  getSession,
  isCommunityConfigured,
  isModerator,
  onCommunityEvent,
  signOut,
} from '../community';
import type { CommunityProfile } from '../community';
import { openAccountDialog } from './AuthDialog';

const mounted = new Set<HTMLElement>();
let menuOpen: HTMLElement | null = null;
let subscribed = false;

function closeMenu(): void {
  if (menuOpen) {
    menuOpen.remove();
    menuOpen = null;
  }
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  onCommunityEvent(() => {
    closeMenu();
    for (const container of [...mounted]) {
      if (!container.isConnected) mounted.delete(container);
      else void paint(container);
    }
  });
  document.addEventListener('click', (event) => {
    if (menuOpen && event.target instanceof Node && !menuOpen.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function avatarBadge(profile: CommunityProfile | null, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const url = avatarUrl(profile?.avatarPath ?? null);
  if (url) {
    return el('span', { className: `community-avatar community-avatar-${size}` },
      el('img', { src: url, alt: '', loading: 'lazy' }),
    );
  }
  return el('span', {
    className: `community-avatar community-avatar-${size} community-avatar-fallback`,
    'aria-hidden': 'true',
    text: initials(profile?.username ?? 'ym'),
  });
}

function openMenu(anchor: HTMLElement, profile: CommunityProfile | null, moderator: boolean): void {
  closeMenu();
  const menu = el('div', { className: 'community-account-menu', role: 'menu' },
    el('div', { className: 'community-account-menu-header' },
      avatarBadge(profile, 'lg'),
      el('div', {},
        el('p', { className: 'community-account-name', text: profile?.username ?? 'Reader' }),
        profile ? el('p', { className: 'community-account-since', text: `Joined ${new Date(profile.createdAt).toLocaleDateString()}` }) : null,
      ),
    ),
    profile ? el('button', {
      className: 'community-account-menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'View public profile',
      onclick: () => {
        closeMenu();
        window.location.hash = `user/${encodeURIComponent(profile.username)}`;
      },
    }) : null,
    el('button', {
      className: 'community-account-menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'Edit profile',
      onclick: () => { closeMenu(); openAccountDialog('profile'); },
    }),
    moderator ? el('button', {
      className: 'community-account-menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'Moderation',
      onclick: () => {
        closeMenu();
        window.location.hash = 'community-admin';
      },
    }) : null,
    el('button', {
      className: 'community-account-menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'Sign out',
      onclick: () => { closeMenu(); void signOut(); },
    }),
  );

  anchor.appendChild(menu);
  menuOpen = menu;
}

async function paint(container: HTMLElement): Promise<void> {
  empty(container);

  if (!isCommunityConfigured()) {
    container.appendChild(el('span', {
      className: 'community-account-unavailable',
      title: 'Community accounts are not configured for this deployment.',
      text: 'Community unavailable',
    }));
    return;
  }

  const session = await getSession();
  if (!session) {
    container.appendChild(el('button', {
      className: 'community-account-signin',
      type: 'button',
      text: 'Sign in',
      onclick: () => openAccountDialog('sign-in'),
    }));
    container.appendChild(el('button', {
      className: 'community-account-register',
      type: 'button',
      text: 'Create account',
      onclick: () => openAccountDialog('sign-up'),
    }));
    return;
  }

  const profile = await getMyProfile();
  const button = el('button', {
    className: 'community-account-button',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-label': 'Account menu',
  },
    avatarBadge(profile),
    el('span', { className: 'community-account-username', text: profile?.username ?? 'Reader' }),
  );
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menuOpen?.parentElement === button) {
      closeMenu();
      return;
    }
    void (async () => {
      const moderator = await secureModeratorCheck();
      openMenu(button, profile, moderator);
    })();
  });
  container.appendChild(button);
}

let moderatorCache: { id: string; value: boolean } | null = null;

async function secureModeratorCheck(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (moderatorCache?.id === user.id) return moderatorCache.value;
  const value = await isModerator();
  moderatorCache = { id: user.id, value };
  return value;
}

export function renderAccountMenu(container: HTMLElement): void {
  ensureSubscription();
  mounted.add(container);
  void paint(container);
}
