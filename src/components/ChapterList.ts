/* ─── ChapterList Component ─── */

import { el, empty } from '../utils/dom';
import type { Chapter } from '../models';

export function renderChapterList(
  container: HTMLElement,
  chapters: Chapter[],
  currentChapterId?: string,
  onChapterClick?: (chapterId: string) => void,
): void {
  empty(container);

  if (chapters.length === 0) {
    container.appendChild(el('p', { className: 'chapter-list-empty', text: 'No chapters available.' }));
    return;
  }

  const list = el('ol', { className: 'chapter-list' });

  for (const ch of chapters) {
    const isCurrent = ch.id === currentChapterId;
    const item = el('li', { className: `chapter-list-item${isCurrent ? ' current' : ''}` },
      el('button', {
        className: 'chapter-list-btn',
        'data-chapter-id': ch.id,
        onclick: () => onChapterClick?.(ch.id),
      },
        el('span', { className: 'chapter-list-number', text: `Ch. ${ch.globalChapterNumber}` }),
        el('span', { className: 'chapter-list-title', text: ch.title || `Chapter ${ch.globalChapterNumber}` }),
        el('span', { className: 'chapter-list-words', text: `${ch.wordCount.toLocaleString()}w` }),
      ),
    );
    list.appendChild(item);
  }

  container.appendChild(list);
}