/* ─── NovelGrid Component ─── */

import { el, empty } from '../utils/dom';
import type { Novel, ReadingProgress } from '../models';
import { renderNovelCard } from './NovelCard';

export function renderNovelGrid(
  container: HTMLElement,
  novels: (Novel & { readingProgress?: ReadingProgress })[],
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
}