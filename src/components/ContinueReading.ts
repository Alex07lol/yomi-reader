/* ─── ContinueReading Component ─── */

import { el, empty, truncate, formatDate } from '../utils/dom';
import { router } from '../utils/router';
import type { Novel, ReadingProgress } from '../models';

export function renderContinueReading(
  container: HTMLElement,
  novels: (Novel & { readingProgress?: ReadingProgress })[],
): void {
  empty(container);

  const inProgress = novels
    .filter(n => n.readingProgress)
    .sort((a, b) => (b.readingProgress?.lastRead ?? 0) - (a.readingProgress?.lastRead ?? 0));

  if (inProgress.length === 0) return;

  const section = el('section', { className: 'continue-reading' },
    el('h2', { className: 'section-title', text: 'Continue Reading' }),
    el('div', { className: 'continue-reading-list' },
      ...inProgress.map(n => {
        const p = n.readingProgress!;
        const lastChapter = n.chapters.find(c => c.id === p.chapterId);
        return el('button', {
          className: 'continue-reading-item',
          onclick: () => router.navigate(`reader/${n.id}/${p.chapterId}`),
        },
          el('div', { className: 'continue-reading-cover' },
            n.cover
              ? el('img', { src: n.cover, alt: '', loading: 'lazy' })
              : el('div', { className: 'novel-card-cover-placeholder', text: n.title.charAt(0) }),
          ),
          el('div', { className: 'continue-reading-info' },
            el('span', { className: 'continue-reading-title', text: truncate(n.title, 50) }),
            el('span', { className: 'continue-reading-chapter', text: `Chapter ${p.globalChapterNumber}${lastChapter ? ' – ' + lastChapter.title : ''}` }),
            el('div', { className: 'continue-reading-progress-bar' },
              el('div', { className: 'continue-reading-progress-fill', style: `width: ${Math.round(p.progress * 100)}%` }),
            ),
            el('span', { className: 'continue-reading-time', text: formatDate(p.lastRead) }),
          ),
        );
      }),
    ),
  );

  container.appendChild(section);
}