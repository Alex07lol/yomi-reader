/* ─── NovelGrid Component ─── */

import { el, empty } from '../utils/dom';
import type { Novel, ReadingProgress, ShelfId } from '../models';
import { loadNovelRatings } from '../community';
import { applyNovelCardRating, renderNovelCard } from './NovelCard';

export function renderNovelGrid(
  container: HTMLElement,
  novels: (Novel & { readingProgress?: ReadingProgress; readingShelf?: ShelfId })[],
  emptyMessage: string = 'No novels found.',
): void {
  empty(container);

  if (novels.length === 0) {
    container.appendChild(
      el('div', { className: 'novel-grid-empty', text: emptyMessage }),
    );
    return;
  }

  const grid = el('div', { className: 'novel-grid' });
  for (const novel of novels) {
    grid.appendChild(renderNovelCard(novel, novel.readingProgress));
  }
  container.appendChild(grid);

  // Ratings are decorative and batched: one request fills every visible card,
  // and a failure simply leaves the badges hidden.
  void loadNovelRatings(novels.map((novel) => novel.id)).then((ratings) => {
    grid.querySelectorAll<HTMLElement>('.novel-card[data-novel-id]').forEach((card) => {
      const id = card.dataset.novelId;
      if (id) applyNovelCardRating(card, ratings.get(id) ?? null);
    });
  });
}
