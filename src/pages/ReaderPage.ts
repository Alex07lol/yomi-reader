/* ─── Reader Page ─── */

import { el, empty } from '../utils/dom';
import type { Novel, Chapter } from '../models';
import { fetchNovel, fetchChapters } from '../data';
import { getImportedNovel, getReadingProgress } from '../storage';
import { Reader } from '../components/Reader';

export async function renderReaderPage(
  container: HTMLElement,
  novelId: string,
  chapterId?: string,
): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-reader' });
  container.appendChild(page);

  page.appendChild(el('div', { className: 'loading', text: 'Loading reader…' }));

  let novel: Novel | null;
  let chapters: Chapter[] = [];

  try {
    novel = await fetchNovel(novelId);
    if (novel) {
      chapters = await fetchChapters(novelId);
      novel.chapters = chapters;
    }
  } catch {
    page.innerHTML = '';
    page.appendChild(el('div', { className: 'error-message', text: 'Failed to load reader.' }));
    return;
  }

  if (!novel) {
    page.innerHTML = '';
    page.appendChild(el('div', { className: 'error-message', text: 'Novel not found.' }));
    return;
  }

  page.innerHTML = '';

  const readerEl = el('div', { className: 'reader-wrapper' });
  page.appendChild(readerEl);

  const reader = new Reader(readerEl);

  // Personal imports stay entirely local and never join the shared discussions.
  try {
    if (await getImportedNovel(novel.id)) reader.disableCommunity();
  } catch {
    reader.disableCommunity();
  }

  let initialScrollY = 0;
  let initialChapterId = chapterId;

  if (!initialChapterId) {
    const progress = await getReadingProgress(novel.id);
    if (progress) {
      initialChapterId = progress.chapterId;
      initialScrollY = progress.scrollPosition;
    } else {
      initialChapterId = novel.chapters[0]?.id;
    }
  }

  await reader.load(novel, initialChapterId, initialScrollY);

  (page as any).__reader = reader;
}

export function disposeReader(container: HTMLElement): void {
  const page = container.querySelector('.page-reader');
  if (page && (page as any).__reader) {
    (page as any).__reader.destroy();
  }
}