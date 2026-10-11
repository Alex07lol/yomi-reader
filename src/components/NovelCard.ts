/* ─── NovelCard Component ─── */

import { el } from '../utils/dom';
import { router } from '../utils/router';
import type { Novel, ReadingProgress, ShelfId } from '../models';
import type { LibraryNovelAvailability } from '../data';
import { SHELF_LABELS } from '../utils/shelves';
import { novelProgressPercent } from '../lib/progress-stats';
import { formatRating, getCachedNovelRating, roundedStars } from '../community';
import type { NovelRating } from '../community';

let connectivityListenerInstalled = false;

function setOfflineStatus(card: HTMLElement): void {
  const badge = card.querySelector<HTMLElement>('.novel-card-offline-status');
  if (!badge) return;
  const availability = card.dataset.libraryAvailability;
  const label = availability === 'saved-shared'
    ? 'Available offline'
    : availability === 'shared' && navigator.onLine === false
      ? 'Online only'
      : '';

  badge.hidden = !label;
  badge.textContent = label;
  badge.setAttribute('aria-label', label ? `${card.dataset.novelTitle ?? 'Novel'}: ${label}` : '');
  badge.classList.toggle('is-saved', label === 'Available offline');
  badge.classList.toggle('is-online-only', label === 'Online only');
}

function installConnectivityListener(): void {
  if (connectivityListenerInstalled) return;
  connectivityListenerInstalled = true;
  const refresh = () => {
    document.querySelectorAll<HTMLElement>('.novel-card[data-library-availability]').forEach(setOfflineStatus);
  };
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
}

export function renderNovelCard(
  novel: Novel & { libraryAvailability?: LibraryNovelAvailability; readingShelf?: ShelfId },
  progress?: ReadingProgress,
): HTMLElement {
  installConnectivityListener();
  const statusLabel = novel.status.charAt(0).toUpperCase() + novel.status.slice(1);
  const hasSharedAvailability = novel.libraryAvailability === 'saved-shared' || novel.libraryAvailability === 'shared';

  const card = el('article', { className: 'novel-card' },
    el('div', { className: 'novel-card-cover' },
      novel.cover
        ? el('img', { src: novel.cover, alt: `${novel.title} cover`, loading: 'lazy' })
        : el('div', { className: 'novel-card-cover-placeholder' }, novel.title.charAt(0)),
      el('span', { className: 'novel-card-status', text: statusLabel }),
    ),
    el('div', { className: 'novel-card-body' },
      el('h3', { className: 'novel-card-title', text: novel.title }),
      novel.originalTitle ? el('p', { className: 'novel-card-original-title', text: novel.originalTitle }) : null,
      el('p', { className: 'novel-card-author', text: novel.author }),
      hasSharedAvailability ? el('span', {
        className: 'novel-card-offline-status',
        hidden: true,
        role: 'status',
        'aria-label': '',
      }) : null,
      novel.alternativeTitles.length > 0 ? el('p', { className: 'novel-card-alt-title', text: novel.alternativeTitles.join(', ') }) : null,
      el('p', { className: 'novel-card-description', text: novel.description.slice(0, 120) + (novel.description.length > 120 ? '…' : '') }),
      el('div', { className: 'novel-card-meta' },
        el('span', { className: 'novel-card-meta-item', text: `${novel.chapters.length} chapters` }),
        el('span', { className: 'novel-card-meta-item', text: `${novel.volumes.length} volumes` }),
        el('span', { className: 'novel-card-meta-item', text: `${novel.sourceLanguage} → ${novel.translationLanguage}` }),
      ),
      novel.readingShelf
        ? el('span', { className: `novel-card-shelf novel-card-shelf-${novel.readingShelf}`, text: SHELF_LABELS[novel.readingShelf] })
        : null,
      el('span', { className: 'novel-card-rating', hidden: true, 'aria-hidden': 'true' }),
      el('div', { className: 'novel-card-genres' },
        ...novel.genres.slice(0, 3).map(g => el('span', { className: 'novel-card-genre-tag', text: g })),
        novel.genres.length > 3 ? el('span', { className: 'novel-card-genre-tag', text: `+${novel.genres.length - 3}` }) : null,
      ),
      progress
        ? el('div', { className: 'novel-card-progress' },
            el('div', { className: 'novel-card-progress-bar' },
              // Whole-book percent, not just the current chapter's fraction.
              el('div', { className: 'novel-card-progress-fill', style: `width: ${novelProgressPercent(novel.chapters, progress)}%` }),
            ),
            el('span', { className: 'novel-card-progress-text', text: `Ch. ${progress.globalChapterNumber} · ${novelProgressPercent(novel.chapters, progress)}%` }),
          )
        : null,
    ),
  );

  card.dataset.novelId = novel.id;
  applyNovelCardRating(card, getCachedNovelRating(novel.id));

  if (hasSharedAvailability) {
    card.dataset.libraryAvailability = novel.libraryAvailability;
    card.dataset.novelTitle = novel.title;
    setOfflineStatus(card);
  }

  card.addEventListener('click', () => {
    router.navigate(`novel/${novel.id}`);
  });
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.navigate(`novel/${novel.id}`);
    }
  });

  return card;
}

/** Fills a card's rating badge, or hides it when a novel has no reviews. */
export function applyNovelCardRating(card: HTMLElement, rating: NovelRating | null): void {
  const badge = card.querySelector<HTMLElement>('.novel-card-rating');
  if (!badge) return;
  if (!rating || rating.count === 0 || rating.average === null) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  badge.hidden = false;
  badge.textContent = '';
  badge.setAttribute('aria-label', `Rated ${formatRating(rating.average)} out of 5 from ${rating.count} reviews`);
  badge.append(
    el('span', { className: 'novel-card-rating-stars', text: '★'.repeat(roundedStars(rating.average)) }),
    el('span', { className: 'novel-card-rating-value', text: formatRating(rating.average) }),
    el('span', { className: 'novel-card-rating-count', text: `(${rating.count})` }),
  );
}
