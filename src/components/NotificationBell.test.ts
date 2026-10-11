/* The bell's panel must be a sibling of its trigger, not a child: a row click that
   bubbles through the trigger reopens the panel as it navigates away. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  unread: 2,
  signedIn: true,
  notifications: [] as Record<string, unknown>[],
  markedRead: [] as string[],
}));

vi.mock('../community', () => ({
  isCommunityConfigured: () => true,
  getSession: async () => (h.signedIn ? { user: { id: 'u1' } } : null),
  getUnreadNotificationCount: async () => h.unread,
  listNotifications: async () => ({ notifications: h.notifications, hasMore: false, nextOffset: h.notifications.length }),
  markNotificationRead: async (id: string) => { h.markedRead.push(id); },
  markAllNotificationsRead: async () => { h.unread = 0; },
  notificationTargetPath: () => 'novel/alpha',
  NOTIFICATION_LABELS: { reply: 'replied to you', mention: 'mentioned you', like: 'upvoted your comment' },
  onCommunityEvent: () => () => undefined,
}));

vi.mock('./community-shared', () => ({
  renderAvatar: () => document.createElement('span'),
}));

const { renderNotificationBell } = await import('./NotificationBell');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const button = () => document.querySelector<HTMLButtonElement>('.community-notification-button');
const panel = () => document.querySelector<HTMLElement>('.community-notification-panel');

async function mountAndOpen(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderNotificationBell(container);
  await flush();
  button()!.click();
  await flush();
}

const notification = (id: string) => ({
  id,
  kind: 'reply',
  novelId: 'alpha',
  chapterId: null,
  commentId: `c-${id}`,
  createdAt: new Date().toISOString(),
  readAt: null,
  actor: { username: 'alex', avatarPath: null },
  preview: 'Thanks!',
});

beforeEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  h.unread = 2;
  h.signedIn = true;
  h.notifications = [notification('n1')];
  h.markedRead = [];
});

describe('notification bell', () => {
  it('hides itself when signed out', async () => {
    h.signedIn = false;
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderNotificationBell(container);
    await flush();

    expect(button()).toBeNull();
  });

  it('shows the unread count and opens a panel of notifications', async () => {
    await mountAndOpen();

    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain('alex replied to you');
  });

  it('closes when the trigger is clicked again', async () => {
    await mountAndOpen();
    button()!.click();
    await flush();
    expect(panel()).toBeNull();
  });

  it('closes behind a row and does not reopen while navigating to it', async () => {
    await mountAndOpen();

    panel()!.querySelector<HTMLButtonElement>('.community-notification-item')!.click();
    await flush();

    expect(window.location.hash).toBe('#novel/alpha');
    expect(h.markedRead).toEqual(['n1']);
    expect(panel()).toBeNull();
  });

  it('closes on a click outside and on Escape', async () => {
    await mountAndOpen();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel()).toBeNull();

    button()!.click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel()).toBeNull();
  });
});
