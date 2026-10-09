/* ─── Novel Header Component ─── */

import { el, empty, pluralize } from '../utils/dom';
import type { Novel, ReadingProgress } from '../models';
import { router } from '../utils/router';

export function renderNovelHeader(
  container: HTMLElement,
  novel: Novel,
  progress?: ReadingProgress,
): void {
  empty(container);

  const header = el('header', { className: 'novel-header' });

  const infoRow = el('div', { className: 'novel-header-row' },
    el('div', { className: 'novel-header-cover' },
      novel.cover
        ? el('img', { src: novel.cover, alt: `${novel.title} cover` })
        : el('div', { className: 'novel-header-cover-placeholder' }, novel.title.charAt(0)),
    ),
    el('div', { className: 'novel-header-info' },
      el('h1', { className: 'novel-header-title', text: novel.title }),
      novel.originalTitle ? el('p', { className: 'novel-header-original', text: novel.originalTitle }) : null,
      el('p', { className: 'novel-header-author', text: novel.author }),
      el('div', { className: 'novel-header-languages' },
        el('span', { className: 'novel-header-lang', text: `From: ${novel.sourceLanguage}` }),
        el('span', { className: 'novel-header-lang', text: `→ ${novel.translationLanguage}` }),
      ),
      el('span', {
        className: `novel-header-status status-${novel.status}`,
        text: novel.status.charAt(0).toUpperCase() + novel.status.slice(1),
      }),
    ),
  );
  header.appendChild(infoRow);

  header.appendChild(
    el('div', { className: 'novel-header-description' },
      el('p', { text: novel.description }),
    ),
  );

  if (novel.genres.length > 0) {
    header.appendChild(
      el('div', { className: 'novel-header-tags' },
        el('span', { className: 'novel-header-tags-label', text: 'Genres: ' }),
        ...novel.genres.map(g => el('span', { className: 'tag genre-tag', text: g })),
      ),
    );
  }
  if (novel.tags.length > 0) {
    header.appendChild(
      el('div', { className: 'novel-header-tags' },
        el('span', { className: 'novel-header-tags-label', text: 'Tags: ' }),
        ...novel.tags.map(t => el('span', { className: 'tag', text: t })),
      ),
    );
  }

  header.appendChild(
    el('div', { className: 'novel-header-stats' },
      el('span', { text: pluralize(novel.chapters.length, 'chapter') }),
      el('span', { text: pluralize(novel.volumes.length, 'volume') }),
      el('span', { text: `~${novel.chapters.reduce((s, c) => s + c.wordCount, 0).toLocaleString()} words` }),
    ),
  );

  const actions = el('div', { className: 'novel-header-actions' });

  const firstChapter = novel.chapters[0];
  const resumeChapter = progress
    ? novel.chapters.find(c => c.id === progress.chapterId) ?? firstChapter
    : firstChapter;

  if (resumeChapter) {
    actions.appendChild(
      el('button', {
        className: 'btn btn-primary',
        onclick: () => router.navigate(`reader/${novel.id}/${resumeChapter.id}`),
      }, progress ? 'Continue Reading' : 'Start Reading'),
    );
  }

  const completeDownloads = novel.downloads.filter(download => download.type === 'complete');
  for (const download of completeDownloads) {
    actions.appendChild(
      el('a', {
        className: 'btn btn-secondary novel-download-action',
        href: resolveDownloadUrl(download.url),
        download: `${safeFileName(novel.title)}.epub`,
        'aria-label': `Download ${novel.title} as an EPUB (${formatSize(download.size)})`,
      }, `Download EPUB · ${formatSize(download.size)}`),
    );
  }

  if (progress) {
    const progressBtn = el('button', {
      className: 'btn btn-secondary',
      'aria-label': `Resume at chapter ${progress.globalChapterNumber}`,
      onclick: () => router.navigate(`reader/${novel.id}/${progress.chapterId}`),
    }, `Ch. ${progress.globalChapterNumber} – ${Math.round(progress.progress * 100)}%`);
    actions.appendChild(progressBtn);
  }

  header.appendChild(actions);
  container.appendChild(header);
}

function resolveDownloadUrl(path: string): string {
  if (/^(?:data:|blob:|https?:)/i.test(path)) return path;
  const appBase = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(path, appBase).href;
}

function safeFileName(title: string): string {
  return title.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'yomi-book';
}

function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
