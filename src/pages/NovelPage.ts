/* ─── Novel Detail Page ─── */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import type { Novel, Chapter } from '../models';
import { fetchNovel, fetchChapters } from '../data';
import { getImportedNovel, getReadingProgress } from '../storage';
import { isSharedNovelSaved, removeSharedNovelOffline, saveSharedNovelOffline } from '../storage/offline-books';
import { renderNavbar, renderFooter, renderNovelHeader, renderVolumeList, renderDownloadPanel } from '../components';

function sharedAssetUrl(path: string): URL {
  if (/^(?:data:|blob:|https?:)/i.test(path)) return new URL(path);
  const appBase = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(path, appBase);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The cover image could not be read.'));
    reader.onerror = () => reject(reader.error ?? new Error('The cover image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchSharedCoverDataUrl(coverPath: string): Promise<string> {
  if (!coverPath) throw new Error('This book has no cover image.');
  const response = await fetch(sharedAssetUrl(coverPath));
  if (!response.ok) throw new Error('The cover image could not be downloaded.');
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('The cover file is not a valid image.');

  // Decoding catches broken image responses before they are saved permanently.
  const image = await createImageBitmap(blob);
  const isValidImage = image.width > 0 && image.height > 0;
  image.close();
  if (!isValidImage) throw new Error('The cover file is not a valid image.');
  return readBlobAsDataUrl(blob);
}

async function fetchSharedChapters(novelId: string): Promise<Chapter[]> {
  const url = sharedAssetUrl(`data/chapters/${encodeURIComponent(novelId)}.json`);
  const response = await fetch(url);
  if (!response.ok) throw new Error('The chapters could not be downloaded.');
  const chapters = await response.json() as Chapter[];
  if (!Array.isArray(chapters) || chapters.length === 0 || chapters.some(chapter =>
    !chapter || chapter.novelId !== novelId || typeof chapter.content !== 'string' || !chapter.id
  )) {
    throw new Error('The chapter file is incomplete or invalid.');
  }
  return chapters;
}

function offlineSaveError(error: unknown, removing: boolean): string {
  if (!removing && error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'There is not enough device storage. Remove another offline book, then try again.';
  }
  if (removing) return 'Could not remove the offline copy. Please try again.';
  return 'Could not save this book. Check your connection and device storage, then try again.';
}

export async function renderNovelPage(container: HTMLElement, novelId: string): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-novel' });
  const navbarContainer = el('div', { className: 'navbar-container' });
  const mainContainer = el('main', { className: 'main-content' });
  const footerContainer = el('div', { className: 'footer-container' });

  page.appendChild(navbarContainer);
  page.appendChild(mainContainer);
  page.appendChild(footerContainer);
  container.appendChild(page);

  renderNavbar(navbarContainer, 'novel');
  renderFooter(footerContainer);

  mainContainer.appendChild(el('div', { className: 'loading', text: 'Loading novel…' }));

  let novel: Novel | null;
  let chapters: Chapter[] = [];
  let isPersonalNovel = false;

  try {
    novel = await fetchNovel(novelId);
    if (novel) {
      isPersonalNovel = !!await getImportedNovel(novelId);
      chapters = await fetchChapters(novelId);
    }
  } catch {
    mainContainer.innerHTML = '';
    mainContainer.appendChild(el('div', { className: 'error-message', text: 'Failed to load novel.' }));
    return;
  }

  if (!novel) {
    mainContainer.innerHTML = '';
    mainContainer.appendChild(el('div', { className: 'error-message', text: 'Novel not found.' }));
    return;
  }

  mainContainer.innerHTML = '';

  const progress = await getReadingProgress(novel.id);

  // Header
  const headerContainer = el('div', { className: 'novel-page-header' });
  mainContainer.appendChild(headerContainer);
  renderNovelHeader(headerContainer, novel, progress);

  if (!isPersonalNovel) {
    const actions = headerContainer.querySelector<HTMLElement>('.novel-header-actions');
    if (actions) {
      const saveButton = el('button', {
        className: 'btn btn-secondary offline-book-action',
        type: 'button',
        disabled: true,
        text: 'Checking…',
      });
      const status = el('span', {
        className: 'offline-book-status',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      });
      let isSaved = false;
      let busy = false;

      const updateButton = () => {
        saveButton.textContent = busy ? (isSaved ? 'Removing…' : 'Saving…') :
          (isSaved ? 'Remove offline copy' : 'Save for offline');
        saveButton.disabled = busy;
        saveButton.setAttribute('aria-busy', String(busy));
      };

      saveButton.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        status.textContent = '';
        updateButton();
        try {
          if (isSaved) {
            await removeSharedNovelOffline(novel.id);
            isSaved = false;
            status.textContent = 'Offline copy removed.';
          } else {
            const [sharedChapters, cover] = await Promise.all([
              fetchSharedChapters(novel.id),
              fetchSharedCoverDataUrl(novel.cover),
            ]);
            await saveSharedNovelOffline({ ...novel, cover }, sharedChapters);
            isSaved = true;
            status.textContent = 'Available offline.';
          }
        } catch (error) {
          status.textContent = offlineSaveError(error, isSaved);
        } finally {
          busy = false;
          updateButton();
        }
      });

      actions.append(saveButton, status);
      try {
        isSaved = await isSharedNovelSaved(novel.id);
        status.textContent = isSaved ? 'Available offline.' : '';
      } catch {
        isSaved = false;
        status.textContent = 'Could not check offline storage. You can still try saving.';
      }
      updateButton();
    }
  }

  // Layout: sidebar (volumes) + content
  const layout = el('div', { className: 'novel-page-layout' });
  mainContainer.appendChild(layout);

  const sidebar = el('aside', { className: 'novel-page-sidebar' });
  const content = el('div', { className: 'novel-page-content' });

  layout.appendChild(sidebar);
  layout.appendChild(content);

  // Volumes / Chapters sidebar
  const volSection = el('section', { className: 'novel-page-section' },
    el('h3', { className: 'section-title', text: 'Chapters' }),
  );
  const volumeContainer = el('div', { className: 'volume-list-container' });
  volSection.appendChild(volumeContainer);
  sidebar.appendChild(volSection);

  renderVolumeList(volumeContainer, novel.volumes, chapters, progress?.chapterId, (chapterId) => {
    router.navigate(`reader/${novel.id}/${chapterId}`);
  });

  // Downloads
  const volumeDownloads = novel.downloads.filter(download => download.type === 'volume');
  if (volumeDownloads.length > 0) {
    const downloadSection = el('section', { className: 'novel-page-section' },
      el('h3', { className: 'section-title', text: 'Downloads' }),
    );
    const downloadContainer = el('div', { className: 'download-container' });
    downloadSection.appendChild(downloadContainer);
    sidebar.appendChild(downloadSection);

    renderDownloadPanel(downloadContainer, volumeDownloads, novel.volumes);
  }

  // Quick read section
  const quickRead = el('section', { className: 'novel-page-section' },
    el('h3', { className: 'section-title', text: 'Start Reading' }),
    el('div', { className: 'quick-read-grid' },
      ...novel.volumes.slice(0, 6).map(v => {
        const volChapters = chapters.filter(c => c.volumeId === v.id);
        return el('button', {
          className: 'quick-read-card',
          onclick: () => {
            const firstCh = volChapters[0];
            if (firstCh) router.navigate(`reader/${novel.id}/${firstCh.id}`);
          },
        },
          v.cover ? el('img', { src: v.cover, alt: '', loading: 'lazy' }) : null,
          el('span', { className: 'quick-read-title', text: v.title || `Volume ${v.volumeNumber}` }),
          el('span', { className: 'quick-read-count', text: `${volChapters.length} chapters` }),
        );
      }),
    ),
  );
  content.appendChild(quickRead);
}
