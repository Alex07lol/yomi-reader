/* ─── Shelf updates ───
   A small navbar icon reporting chapters published since the reader last opened
   the novels on their shelves. Local-first: the shelves and the "seen" baselines
   both live on the device, so it works signed out and never needs the community
   backend. It hides itself entirely when nothing is shelved. */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import { getActiveShelves } from '../storage/shelves';
import { getShelfUpdateBaselines, markShelfUpdatesSeen } from '../storage/updates';
import { fetchAllNovels } from '../data';
import {
  baselinesToEstablish,
  computeShelfUpdates,
  countChapters,
  type ShelfUpdate,
} from '../lib/shelf-updates';
import { onCommunityEvent } from '../community';
import { updatesIcon } from './icons';

const mounted = new Set<HTMLElement>();
let openPanel: HTMLElement | null = null;
let subscribed = false;
let pending: ShelfUpdate[] = [];

function closePanel(): void {
  if (!openPanel) return;
  openPanel.remove();
  openPanel = null;
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  // Shelves can change when an account syncs; repaint so the icon follows.
  onCommunityEvent(() => {
    closePanel();
    for (const container of [...mounted]) {
      if (!container.isConnected) mounted.delete(container);
      else void paint(container);
    }
  });
  document.addEventListener('click', (event) => {
    if (openPanel && event.target instanceof Node && !openPanel.contains(event.target)) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });
}

function updateLabel(count: number): string {
  return `+${count} chapter${count === 1 ? '' : 's'}`;
}

function open(container: HTMLElement, button: HTMLButtonElement): void {
  closePanel();

  const panel = el('div', {
    className: 'shelf-updates-panel',
    role: 'dialog',
    'aria-label': 'New chapters on your shelves',
  });

  if (pending.length === 0) {
    panel.appendChild(el('p', { className: 'shelf-updates-empty', text: 'Nothing new on your shelves.' }));
  } else {
    panel.appendChild(el('p', { className: 'shelf-updates-heading', text: 'New chapters' }));
    for (const update of pending) {
      panel.appendChild(el('button', {
        className: 'shelf-updates-item',
        type: 'button',
        onclick: () => {
          closePanel();
          router.navigate(`novel/${encodeURIComponent(update.novelId)}`);
        },
      },
        el('span', { className: 'shelf-updates-title', text: update.title }),
        el('span', { className: 'shelf-updates-count', text: updateLabel(update.newChapters) }),
      ));
    }
  }

  /* The panel is a sibling of the button, not a child: a click on a row would
     otherwise bubble through the button's own handler and reopen the panel. */
  container.appendChild(panel);
  openPanel = panel;
  button.setAttribute('aria-expanded', 'true');
  panel.querySelector<HTMLButtonElement>('.shelf-updates-item')?.focus();

  // Reading the list is what marks it seen; the panel stays up for this visit.
  const seen = pending.map(update => ({ novelId: update.novelId, chapterCount: update.chapterCount }));
  void markShelfUpdatesSeen(seen)
    .then(() => button.querySelector('.shelf-updates-badge')?.classList.add('is-hidden'))
    .catch(() => undefined);
}

async function paint(container: HTMLElement): Promise<void> {
  empty(container);
  closePanel();

  let shelves: Awaited<ReturnType<typeof getActiveShelves>> = [];
  try {
    shelves = await getActiveShelves();
  } catch {
    return;
  }
  if (shelves.length === 0) return; // Nothing shelved: leave the navbar alone.

  let novels: Awaited<ReturnType<typeof fetchAllNovels>> = [];
  try {
    novels = await fetchAllNovels();
  } catch {
    return;
  }

  const summaries = novels.map(novel => ({
    id: novel.id,
    title: novel.title,
    chapterCount: countChapters(novel),
  }));

  let baselines: Record<string, number> = {};
  try {
    baselines = await getShelfUpdateBaselines();
  } catch {
    baselines = {};
  }

  /* A shelved novel we have never seen yet just records where it stands now, so
     shelving a book never immediately reports itself as an update. */
  const fresh = baselinesToEstablish(summaries, shelves, baselines);
  if (fresh.length > 0) {
    await markShelfUpdatesSeen(fresh).catch(() => undefined);
    for (const entry of fresh) baselines[entry.novelId] = entry.chapterCount;
  }

  pending = computeShelfUpdates(summaries, shelves, baselines);

  const count = pending.length;
  const button = el('button', {
    className: 'shelf-updates-button',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-label': count > 0 ? `Book updates: ${count} new` : 'Book updates',
    title: 'Book updates',
  },
    updatesIcon('shelf-updates-icon'),
    el('span', {
      className: `shelf-updates-badge${count === 0 ? ' is-hidden' : ''}`,
      'aria-hidden': 'true',
      text: count > 9 ? '9+' : String(count),
    }),
  );
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openPanel?.parentElement === container) {
      closePanel();
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    open(container, button);
  });
  container.appendChild(button);
}

export function renderShelfUpdates(container: HTMLElement): void {
  ensureSubscription();
  mounted.add(container);
  void paint(container);
}
