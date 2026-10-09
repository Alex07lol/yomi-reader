/* ─── VolumeList Component ─── */

import { el, empty } from '../utils/dom';
import type { Volume, Chapter } from '../models';
import { renderChapterList } from './ChapterList';

export function renderVolumeList(
  container: HTMLElement,
  volumes: Volume[],
  chapters: Chapter[],
  currentChapterId?: string,
  onChapterClick?: (chapterId: string) => void,
): void {
  empty(container);

  const sortedVolumes = [...volumes].sort((a, b) => a.volumeNumber - b.volumeNumber);

  for (const vol of sortedVolumes) {
    const volChapters = chapters
      .filter(c => c.volumeId === vol.id)
      .sort((a, b) => a.volumeChapterNumber - b.volumeChapterNumber);

    const details = el('details', { className: 'volume-group', open: volChapters.some(c => c.id === currentChapterId) },
      el('summary', { className: 'volume-summary' },
        el('span', { className: 'volume-title', text: vol.title || `Volume ${vol.volumeNumber}` }),
        el('span', { className: 'volume-count', text: `${volChapters.length} chapters` }),
      ),
    );

    const chapterContainer = el('div', { className: 'volume-chapters' });
    renderChapterList(chapterContainer, volChapters, currentChapterId, onChapterClick);
    details.appendChild(chapterContainer);
    container.appendChild(details);
  }
}