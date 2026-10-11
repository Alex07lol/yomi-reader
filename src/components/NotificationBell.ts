/* ─── Navbar notification bell ───
   A compact, lazily-loaded inbox for replies, @mentions and upvotes. It is
   hidden entirely when the community service is unconfigured or the reader is
   signed out, so it can never block the reader. One shared subscription keeps
   every mounted bell in sync. */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import { formatRelativeTime } from '../utils/time';
import {
  NOTIFICATION_LABELS,
  getSession,
  getUnreadNotificationCount,
  isCommunityConfigured,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTargetPath,
  onCommunityEvent,
} from '../community';
import type { CommunityNotification } from '../community';
import { renderAvatar } from './community-shared';
import { bellIcon } from './icons';

const mounted = new Set<HTMLElement>();
let panelOpen: HTMLElement | null = null;
let subscribed = false;

function closePanel(): void {
  if (panelOpen) {
    panelOpen.remove();
    panelOpen = null;
  }
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  onCommunityEvent(() => {
    closePanel();
    for (const container of [...mounted]) {
      if (!container.isConnected) mounted.delete(container);
      else void paint(container);
    }
  });
  document.addEventListener('click', (event) => {
    if (panelOpen && event.target instanceof Node && !panelOpen.contains(event.target)) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });
}

function notificationText(notification: CommunityNotification): string {
  const actor = notification.actor?.username ?? 'A reader';
  return `${actor} ${NOTIFICATION_LABELS[notification.kind]}`;
}

async function openPanel(container: HTMLElement, button: HTMLButtonElement): Promise<void> {
  closePanel();
  const panel = el('div', { className: 'community-notification-panel', role: 'dialog', 'aria-label': 'Notifications' });
  const list = el('div', { className: 'community-notification-list' });
  const status = el('p', { className: 'community-notice', role: 'status', 'aria-live': 'polite' });
  let offset = 0;

  const markAll = el('button', {
    className: 'community-link-button',
    type: 'button',
    text: 'Mark all read',
    onclick: () => void (async () => {
      markAll.disabled = true;
      try {
        await markAllNotificationsRead();
        await refreshUnread(button);
        for (const item of panel.querySelectorAll<HTMLElement>('.community-notification-unread')) {
          item.classList.remove('community-notification-unread');
        }
      } catch (error) {
        status.className = 'community-notice community-notice-error';
        status.textContent = error instanceof Error ? error.message : 'Could not update notifications.';
      } finally {
        markAll.disabled = false;
      }
    })(),
  });

  panel.appendChild(el('div', { className: 'community-notification-header' },
    el('span', { className: 'community-notification-title', text: 'Notifications' }),
    markAll,
  ));
  panel.appendChild(list);
  panel.appendChild(status);
  /* A sibling of the button, not a child: otherwise a click on a notification row
     bubbles through the button's handler and reopens the panel as it navigates. */
  container.appendChild(panel);
  panelOpen = panel;

  const renderPage = (page: { notifications: CommunityNotification[]; hasMore: boolean; nextOffset: number }): void => {
    if (offset === 0) empty(list);
    if (offset === 0 && page.notifications.length === 0) {
      list.appendChild(el('p', { className: 'community-notification-empty', text: 'Nothing new yet.' }));
    }
    for (const notification of page.notifications) list.appendChild(renderItem(notification, button));
    if (page.hasMore) {
      const more = el('button', {
        className: 'community-button community-button-ghost community-notification-more',
        type: 'button',
        text: 'Load more',
        onclick: () => void load(more),
      });
      list.appendChild(more);
    }
    offset = page.nextOffset;
  };

  const load = async (button?: HTMLButtonElement): Promise<void> => {
    if (button) button.disabled = true;
    try {
      renderPage(await listNotifications(offset));
    } catch (error) {
      status.className = 'community-notice community-notice-error';
      status.textContent = error instanceof Error ? error.message : 'Notifications could not be loaded.';
      button?.remove();
    }
  };

  await load();
}

function renderItem(notification: CommunityNotification, anchor: HTMLElement): HTMLElement {
  const unread = notification.readAt === null;
  const item = el('button', {
    className: `community-notification-item${unread ? ' community-notification-unread' : ''}`,
    type: 'button',
    onclick: () => void openNotification(notification, item, anchor),
  },
    renderAvatar(notification.actor),
    el('span', { className: 'community-notification-body' },
      el('span', { className: 'community-notification-text', text: notificationText(notification) }),
      notification.preview
        ? el('span', { className: 'community-notification-preview', text: notification.preview })
        : null,
      el('span', {
        className: 'community-notification-time',
        text: formatRelativeTime(notification.createdAt),
      }),
    ),
  );
  return item;
}

async function openNotification(notification: CommunityNotification, item: HTMLElement, anchor: HTMLElement): Promise<void> {
  if (notification.readAt === null) {
    try {
      await markNotificationRead(notification.id);
      item.classList.remove('community-notification-unread');
      await refreshUnread(anchor);
    } catch {
      // Navigating is more useful than blocking on a failed read receipt.
    }
  }
  closePanel();
  router.navigate(notificationTargetPath(notification));
}

async function refreshUnread(container: HTMLElement): Promise<void> {
  const badge = container.querySelector<HTMLElement>('.community-notification-badge');
  if (!badge) return;
  const count = await getUnreadNotificationCount();
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', count === 0 ? '' : `${count} unread notifications`);
}

async function paint(container: HTMLElement): Promise<void> {
  empty(container);
  if (!isCommunityConfigured()) return;
  const session = await getSession();
  if (!session) return;

  const button = el('button', {
    className: 'community-notification-button',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-label': 'Notifications',
  },
    bellIcon('community-notification-icon'),
    el('span', { className: 'community-notification-badge', hidden: true, 'aria-hidden': 'true' }),
  ) as HTMLButtonElement;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panelOpen?.parentElement === container) {
      closePanel();
      return;
    }
    void openPanel(container, button);
  });
  container.appendChild(button);
  void refreshUnread(container);
}

export function renderNotificationBell(container: HTMLElement): void {
  ensureSubscription();
  mounted.add(container);
  void paint(container);
}
