/* ─── Top-right menu ───
   One icon-only control in the navbar, holding the three things a reader reaches
   for: their account (sign in / create account when signed out), the appearance
   themes, and bookmarks. Keeping them together is what keeps the navbar quiet.

   The panel is rebuilt from fresh state every time it opens, and one shared
   community-event subscription re-renders any mounted trigger, so signing in or
   out is reflected without leaking listeners. */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import type { ThemeId } from '../models';
import { applyTheme } from '../theme';
import { loadUserSettings, saveUserSettings } from '../storage';
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
import { appearanceIcon, bookmarkIcon, checkIcon, menuIcon, userIcon } from './icons';

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'oled', label: 'OLED Black' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'system', label: 'System' },
];

interface MenuState {
  configured: boolean;
  signedIn: boolean;
  profile: CommunityProfile | null;
  moderator: boolean;
  theme: ThemeId;
}

const mounted = new Set<HTMLElement>();
const triggers = new Map<HTMLElement, HTMLButtonElement>();
let openPanel: HTMLElement | null = null;
let subscribed = false;
let moderatorCache: { id: string; value: boolean } | null = null;

function closeMenu(): void {
  if (!openPanel) return;
  openPanel.remove();
  openPanel = null;
  for (const trigger of triggers.values()) trigger.setAttribute('aria-expanded', 'false');
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  onCommunityEvent(() => {
    closeMenu();
    for (const container of [...mounted]) {
      if (!container.isConnected) mounted.delete(container);
      else void paintTrigger(container);
    }
  });
  document.addEventListener('click', (event) => {
    if (openPanel && event.target instanceof Node && !openPanel.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

async function secureModeratorCheck(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (moderatorCache?.id === user.id) return moderatorCache.value;
  const value = await isModerator();
  moderatorCache = { id: user.id, value };
  return value;
}

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function avatarBadge(profile: CommunityProfile | null, size: 'sm' | 'lg'): HTMLElement {
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

/* ── Panel pieces ── */

function section(iconNode: SVGSVGElement, label: string): HTMLElement {
  return el('p', { className: 'top-menu-section' }, iconNode, el('span', { text: label }));
}

function item(options: {
  icon?: SVGSVGElement;
  label: string;
  role?: 'menuitem' | 'menuitemradio';
  checked?: boolean;
  onSelect: () => void;
}): HTMLElement {
  const classes = ['top-menu-item'];
  if (options.checked) classes.push('is-active');
  const button = el('button', {
    className: classes.join(' '),
    type: 'button',
    role: options.role ?? 'menuitem',
    ...(options.role === 'menuitemradio' ? { 'aria-checked': String(Boolean(options.checked)) } : {}),
    onclick: options.onSelect,
  },
    options.icon ?? el('span', { className: 'top-menu-icon-slot' }),
    el('span', { className: 'top-menu-item-label', text: options.label }),
    ...(options.role === 'menuitemradio' && options.checked
      ? [checkIcon('top-menu-check app-icon')]
      : []),
  );
  return button;
}

async function readState(): Promise<MenuState> {
  const configured = isCommunityConfigured();
  const theme = (await loadUserSettings().catch(() => null))?.theme ?? 'system';
  if (!configured) return { configured, signedIn: false, profile: null, moderator: false, theme };

  const session = await getSession().catch(() => null);
  if (!session) return { configured, signedIn: false, profile: null, moderator: false, theme };

  const profile = await getMyProfile().catch(() => null);
  const moderator = await secureModeratorCheck().catch(() => false);
  return { configured, signedIn: true, profile, moderator, theme };
}

function accountSection(state: MenuState): HTMLElement {
  if (!state.configured) {
    return el('div', { className: 'top-menu-group' },
      el('p', { className: 'top-menu-note', text: 'Accounts are not configured for this deployment.' }),
    );
  }

  if (!state.signedIn) {
    return el('div', { className: 'top-menu-group' },
      item({ icon: userIcon('top-menu-icon app-icon'), label: 'Sign in', onSelect: () => { closeMenu(); openAccountDialog('sign-in'); } }),
      item({ label: 'Create account', onSelect: () => { closeMenu(); openAccountDialog('sign-up'); } }),
    );
  }

  const username = state.profile?.username ?? 'Reader';
  return el('div', { className: 'top-menu-group' },
    el('div', { className: 'top-menu-header' },
      avatarBadge(state.profile, 'lg'),
      el('div', { className: 'top-menu-identity' },
        el('p', { className: 'top-menu-name', text: username }),
        state.profile
          ? el('p', { className: 'top-menu-since', text: `Joined ${new Date(state.profile.createdAt).toLocaleDateString()}` })
          : null,
      ),
    ),
    state.profile
      ? item({
          label: 'View public profile',
          onSelect: () => { closeMenu(); router.navigate(`user/${encodeURIComponent(state.profile!.username)}`); },
        })
      : null,
    item({ label: 'Edit profile', onSelect: () => { closeMenu(); openAccountDialog('profile'); } }),
    state.moderator
      ? item({ label: 'Moderation', onSelect: () => { closeMenu(); router.navigate('community-admin'); } })
      : null,
    item({ label: 'Sign out', onSelect: () => { closeMenu(); void signOut(); } }),
  );
}

function paintPanel(panel: HTMLElement, state: MenuState): void {
  empty(panel);

  panel.appendChild(section(userIcon('top-menu-section-icon app-icon'), 'Account'));
  panel.appendChild(accountSection(state));

  panel.appendChild(section(appearanceIcon('top-menu-section-icon app-icon'), 'Appearance'));
  panel.appendChild(el('div', { className: 'top-menu-group' },
    ...THEMES.map(theme => item({
      label: theme.label,
      role: 'menuitemradio',
      checked: theme.id === state.theme,
      onSelect: () => {
        // Stay open so themes can be compared; the checks move to the new choice.
        void selectTheme(theme.id, panel, state);
      },
    })),
  ));

  panel.appendChild(section(bookmarkIcon('top-menu-section-icon app-icon'), 'Bookmarks'));
  panel.appendChild(el('div', { className: 'top-menu-group' },
    item({
      icon: bookmarkIcon('top-menu-icon app-icon'),
      label: 'Bookmarked novels',
      onSelect: () => { closeMenu(); router.navigate('library?bookmarked=1'); },
    }),
  ));
}

async function selectTheme(theme: ThemeId, panel: HTMLElement, state: MenuState): Promise<void> {
  applyTheme(theme);
  state.theme = theme;
  const settings = await loadUserSettings().catch(() => null);
  if (settings) {
    settings.theme = theme;
    await saveUserSettings(settings).catch(() => undefined);
  }
  paintPanel(panel, state);
  panel.querySelector<HTMLButtonElement>('.top-menu-item.is-active')?.focus();
}

function buildTrigger(): HTMLButtonElement {
  return el('button', {
    className: 'top-menu-trigger',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': 'Account, appearance and bookmarks',
    title: 'Menu',
  }, menuIcon('top-menu-trigger-icon app-icon'));
}

async function paintTrigger(container: HTMLElement): Promise<void> {
  const existing = triggers.get(container);
  if (existing && container.contains(existing)) {
    existing.setAttribute('aria-expanded', String(openPanel !== null && openPanel.parentElement === container));
    return;
  }
  empty(container);
  const trigger = buildTrigger();
  triggers.set(container, trigger);
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openPanel?.parentElement === container) {
      closeMenu();
      return;
    }
    void open(container, trigger);
  });
  container.appendChild(trigger);
}

async function open(container: HTMLElement, trigger: HTMLButtonElement): Promise<void> {
  closeMenu();
  const state = await readState();
  const panel = el('div', { className: 'top-menu-panel', role: 'menu', 'aria-label': 'Menu' });
  paintPanel(panel, state);
  container.appendChild(panel);
  openPanel = panel;
  trigger.setAttribute('aria-expanded', 'true');
  panel.querySelector<HTMLButtonElement>('button')?.focus();
}

export function renderTopMenu(container: HTMLElement): void {
  ensureSubscription();
  mounted.add(container);
  void paintTrigger(container);
}
