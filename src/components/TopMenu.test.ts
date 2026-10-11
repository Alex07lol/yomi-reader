import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  theme: 'system',
  savedThemes: [] as string[],
  appliedThemes: [] as string[],
  dialogs: [] as string[],
  signOuts: 0,
}));

vi.mock('../community', () => ({
  isCommunityConfigured: () => h.configured,
  getSession: async () => (h.signedIn ? { user: { id: 'u1' } } : null),
  getCurrentUser: async () => (h.signedIn ? { id: 'u1' } : null),
  getMyProfile: async () =>
    h.signedIn ? { username: 'alex', avatarPath: null, createdAt: '2026-01-02T00:00:00Z' } : null,
  isModerator: async () => false,
  signOut: async () => { h.signOuts += 1; h.signedIn = false; },
  avatarUrl: () => null,
  onCommunityEvent: () => () => undefined,
}));

vi.mock('../storage', () => ({
  loadUserSettings: async () => ({ theme: h.theme }),
  saveUserSettings: async (settings: { theme: string }) => { h.savedThemes.push(settings.theme); },
}));

vi.mock('../theme', () => ({
  applyTheme: (theme: string) => { h.appliedThemes.push(theme); },
}));

vi.mock('./AuthDialog', () => ({
  openAccountDialog: (mode: string) => { h.dialogs.push(mode); },
}));

const { renderTopMenu } = await import('./TopMenu');

/** Lets the menu's async paint settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function mount(): { container: HTMLElement; trigger: HTMLButtonElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderTopMenu(container);
  const trigger = container.querySelector<HTMLButtonElement>('.top-menu-trigger')!;
  return { container, trigger };
}

const panel = () => document.querySelector<HTMLElement>('.top-menu-panel');
const itemByText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.top-menu-item')]
    .find(button => button.textContent?.trim().startsWith(text))!;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.innerHTML = '<head></head><body></body>'.replace(/^/, '');
  window.location.hash = '';
  h.configured = true;
  h.signedIn = false;
  h.theme = 'system';
  h.savedThemes = [];
  h.appliedThemes = [];
  h.dialogs = [];
  h.signOuts = 0;
});

describe('top-right menu', () => {
  it('renders one labelled trigger and no panel until it is opened', async () => {
    const { container, trigger } = mount();
    await flush();

    expect(container.querySelectorAll('.top-menu-trigger')).toHaveLength(1);
    expect(trigger.getAttribute('aria-label')).toBe('Account, appearance and bookmarks');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('opens a panel holding account, appearance and bookmarks', async () => {
    const { trigger } = mount();
    await flush();

    trigger.click();
    await flush();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const sections = [...panel()!.querySelectorAll('.top-menu-section')].map(el => el.textContent);
    expect(sections).toEqual(['Account', 'Appearance', 'Bookmarks']);
    expect(document.querySelector('.community-notification-icon')).toBeNull();
    expect(panel()!.querySelectorAll('svg.app-icon').length).toBeGreaterThan(3);
  });

  it('offers sign in and create account when signed out, routing to the dialog', async () => {
    const { trigger } = mount();
    await flush();
    trigger.click();
    await flush();

    expect(itemByText('Sign in')).toBeTruthy();
    expect(itemByText('Create account')).toBeTruthy();

    itemByText('Sign in').click();
    await flush();

    expect(h.dialogs).toEqual(['sign-in']);
    expect(panel()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the reader and a sign-out when signed in', async () => {
    h.signedIn = true;
    const { trigger } = mount();
    await flush();
    trigger.click();
    await flush();

    expect(panel()!.textContent).toContain('alex');
    expect(itemByText('Edit profile')).toBeTruthy();

    itemByText('Sign out').click();
    await flush();
    expect(h.signOuts).toBe(1);
  });

  it('says so when accounts are not configured, and still offers the rest', async () => {
    h.configured = false;
    const { trigger } = mount();
    await flush();
    trigger.click();
    await flush();

    expect(panel()!.textContent).toContain('not configured');
    expect(itemByText('Bookmarked novels')).toBeTruthy();
    expect(itemByText('Sepia')).toBeTruthy();
  });

  it('applies a theme, saves it, and keeps the panel open with the check moved', async () => {
    const { trigger } = mount();
    await flush();
    trigger.click();
    await flush();

    itemByText('Sepia').click();
    await flush();

    expect(h.appliedThemes).toEqual(['sepia']);
    expect(h.savedThemes).toEqual(['sepia']);
    expect(panel()).not.toBeNull();
    expect(itemByText('Sepia').classList.contains('is-active')).toBe(true);
    expect(itemByText('System').classList.contains('is-active')).toBe(false);
  });

  it('sends the reader to the bookmarked library and closes behind them', async () => {
    const { trigger } = mount();
    await flush();
    trigger.click();
    await flush();

    itemByText('Bookmarked novels').click();
    await flush();

    expect(window.location.hash).toBe('#library?bookmarked=1');
    expect(panel()).toBeNull();
  });

  it('closes on Escape and on a click outside', async () => {
    const { trigger } = mount();
    await flush();

    trigger.click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel()).toBeNull();

    trigger.click();
    await flush();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel()).toBeNull();
  });
});
