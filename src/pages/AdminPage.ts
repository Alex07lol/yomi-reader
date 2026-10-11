/* EPUB import page: review metadata and save books locally for this browser. */

import { el, empty } from '../utils/dom';
import { parseEpub, type ParsedEpub } from '../epub-import';
import type { Chapter, Novel } from '../models';
import { saveImportedNovel } from '../storage';
import { getStorageEstimate, requestPersistentStorage } from '../storage';
import { exportLibraryBackup, inspectLibraryBackup, restoreLibraryBackup, type BackupPreview } from '../storage/backup';
import { clearNovelCache, fetchAllNovels } from '../data';
import { volumeId } from '../lib/enhanced-models';
import { renderNavbar, renderFooter } from '../components';
import { router } from '../utils/router';
import { normalizeSharedUrl, takeSharedContent } from '../lib/share-target';

export async function renderAdminPage(container: HTMLElement): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-admin' });
  const navbarContainer = el('div', { className: 'navbar-container' });
  const mainContainer = el('main', { className: 'main-content' });
  const footerContainer = el('div', { className: 'footer-container' });
  page.append(navbarContainer, mainContainer, footerContainer);
  container.appendChild(page);

  renderNavbar(navbarContainer, 'admin');
  renderFooter(footerContainer);

  const sharedContent = takeSharedContent();

  let parsed: ParsedEpub | null = null;
  let coverOverride: string | null = null;
  let selectedEpubName = '';
  let selectedCoverName = '';

  const epubInput = el('input', { type: 'file', accept: '.epub,application/epub+zip', 'aria-label': 'Choose an EPUB file' });
  const coverInput = el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Choose a cover image' });
  const epubFilename = el('span', { className: 'selected-filename', text: 'No EPUB selected' });
  const coverFilename = el('span', { className: 'selected-filename', text: 'Optional · use the cover inside the EPUB' });
  const coverPreview = el('div', { className: 'cover-preview-empty', text: 'Cover preview' });
  const review = el('div', { className: 'import-results', 'aria-live': 'polite' });
  const status = el('p', { className: 'import-status', role: 'status' });
  const importButton = el('button', { className: 'btn btn-primary import-submit', type: 'button', disabled: true, text: 'Add to library' });

  const deviceStorageStatus = el('p', { className: 'device-storage-status', role: 'status', 'aria-live': 'polite', text: 'Checking this browser’s storage…' });
  const storageEstimate = el('p', { className: 'device-storage-estimate', text: 'Storage use is an estimate supplied by your browser.' });
  const backupStatus = el('p', { className: 'backup-status', role: 'status', 'aria-live': 'polite' });
  const backupPreview = el('div', { className: 'backup-preview', 'aria-live': 'polite' });
  const restoreButton = el('button', { className: 'btn btn-primary', type: 'button', disabled: true, text: 'Restore backup' });
  const backupInput = el('input', { className: 'backup-file-input', type: 'file', accept: '.zip,application/zip', 'aria-label': 'Choose a Yomi library backup ZIP file' });
  let selectedBackup: File | null = null;
  let backupInspectionId = 0;
  let selectedBackupInspectionId = 0;

  const setBackupStatus = (message: string, kind: 'error' | 'success' | 'info' = 'info') => {
    backupStatus.textContent = message;
    backupStatus.className = `backup-status ${kind}`;
  };

  const renderBackupPreview = (preview: BackupPreview, file: File) => {
    empty(backupPreview);
    const summary = el('p', { className: 'backup-preview-summary', text: `${file.name}: ${preview.novels.toLocaleString()} books, ${preview.chapters.toLocaleString()} chapters, and ${preview.progress.toLocaleString()} reading progress records.` });
    backupPreview.appendChild(summary);
    if (preview.conflicts.length) {
      backupPreview.appendChild(el('p', { className: 'backup-conflicts-heading', text: `${preview.conflicts.length.toLocaleString()} book IDs already exist. Those books and their chapters will be skipped:` }));
      const ids = el('ul', { className: 'backup-conflict-list' });
      preview.conflicts.forEach(id => ids.appendChild(el('li', { text: id })));
      backupPreview.appendChild(ids);
    } else {
      backupPreview.appendChild(el('p', { className: 'backup-no-conflicts', text: 'No matching book IDs were found.' }));
    }
    backupPreview.appendChild(el('p', { className: 'backup-restore-note', text: 'Restoring adds books that are not already here. Existing-book collisions are skipped, newer saved reading progress is kept, and Yomi settings in this backup replace your current Yomi settings.' }));
  };

  const updateStorageDetails = async () => {
    const [persistent, estimate] = await Promise.all([requestPersistentStorage(), getStorageEstimate()]);
    if (!persistent.supported) {
      deviceStorageStatus.textContent = 'This browser does not report persistent-storage support. Your library is still available here, subject to browser storage policies.';
    } else if (persistent.granted) {
      deviceStorageStatus.textContent = 'This browser has granted persistent storage for Yomi, which helps protect your library from automatic cleanup.';
    } else {
      deviceStorageStatus.textContent = 'Persistent storage was not granted. Your library remains available, but browser settings or cleanup may remove site data.';
    }
    if (estimate.usage !== undefined && estimate.quota !== undefined) {
      storageEstimate.textContent = `Approx. ${formatBytes(estimate.usage)} used of ${formatBytes(estimate.quota)} available for this site. This browser estimate may include other Yomi data.`;
    } else {
      storageEstimate.textContent = 'Storage use estimate is unavailable in this browser.';
    }
  };

  const downloadBackup = el('button', {
    className: 'btn btn-primary', type: 'button', text: 'Download backup',
    onclick: async () => {
      downloadBackup.disabled = true;
      setBackupStatus('Preparing a backup of this device’s personal library…');
      try {
        const blob = await exportLibraryBackup();
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: `yomi-library-backup-${new Date().toISOString().slice(0, 10)}.zip`, className: 'backup-download-link' });
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setBackupStatus('Backup download started. Keep the ZIP somewhere safe.', 'success');
      } catch (error) {
        setBackupStatus(`Could not create the backup. ${error instanceof Error ? error.message : 'Check available storage and try again.'}`, 'error');
      } finally {
        downloadBackup.disabled = false;
      }
    },
  });

  const chooseBackup = el('button', { className: 'btn btn-secondary', type: 'button', text: 'Choose backup ZIP', onclick: () => backupInput.click() });
  backupInput.addEventListener('change', async () => {
    const file = backupInput.files?.[0];
    const inspectionId = ++backupInspectionId;
    selectedBackup = null;
    selectedBackupInspectionId = 0;
    restoreButton.disabled = true;
    empty(backupPreview);
    if (!file) {
      chooseBackup.disabled = false;
      return;
    }
    chooseBackup.disabled = true;
    setBackupStatus('Checking the backup. Your library has not been changed…');
    try {
      const preview = await inspectLibraryBackup(file);
      if (inspectionId !== backupInspectionId) return;
      selectedBackup = file;
      selectedBackupInspectionId = inspectionId;
      renderBackupPreview(preview, file);
      restoreButton.disabled = false;
      setBackupStatus('Backup checked. Review the details, then choose Restore backup to continue.', 'success');
    } catch (error) {
      if (inspectionId !== backupInspectionId) return;
      backupInput.value = '';
      setBackupStatus(`Could not use this backup. ${error instanceof Error ? error.message : 'Choose a valid Yomi backup ZIP and try again.'}`, 'error');
    } finally {
      if (inspectionId === backupInspectionId) chooseBackup.disabled = false;
    }
  });
  backupInput.addEventListener('cancel', () => {
    chooseBackup.disabled = false;
  });
  restoreButton.addEventListener('click', async () => {
    const currentFile = backupInput.files?.[0];
    if (!selectedBackup || selectedBackupInspectionId !== backupInspectionId || currentFile !== selectedBackup) {
      selectedBackup = null;
      selectedBackupInspectionId = 0;
      restoreButton.disabled = true;
      empty(backupPreview);
      setBackupStatus('Choose and review a backup ZIP again before restoring.', 'info');
      return;
    }
    const file = selectedBackup;
    const inspectionId = selectedBackupInspectionId;
    restoreButton.disabled = true;
    chooseBackup.disabled = true;
    setBackupStatus('Restoring books and reading data on this device…');
    try {
      const summary = await restoreLibraryBackup(file, 'skip-existing');
      const result = `${summary.addedNovels.toLocaleString()} books and ${summary.addedChapters.toLocaleString()} chapters added; ${summary.skippedNovels.toLocaleString()} existing books skipped; ${summary.restoredProgress.toLocaleString()} reading positions restored.`;
      setBackupStatus(`Restore complete. ${result}`, 'success');
      selectedBackup = null;
      selectedBackupInspectionId = 0;
      empty(backupPreview);
      backupInput.value = '';
    } catch (error) {
      setBackupStatus(`Restore failed. No success was reported. ${error instanceof Error ? error.message : 'Check the backup and available storage, then try again.'}`, 'error');
      selectedBackup = null;
      selectedBackupInspectionId = 0;
      backupInput.value = '';
      empty(backupPreview);
    } finally {
      // The picker stays unavailable throughout restore so the reviewed file
      // cannot be replaced while its transaction is running.
      if (inspectionId === backupInspectionId) chooseBackup.disabled = false;
      restoreButton.disabled = true;
    }
  });

  const deviceLibraryPanel = el('section', { className: 'import-panel device-library-panel', 'aria-labelledby': 'device-library-heading' },
    el('div', { className: 'device-library-header' },
      el('div', {}, el('p', { className: 'eyebrow', text: 'Private to this browser' }), el('h2', { id: 'device-library-heading', text: 'Your device library' })),
      el('span', { className: 'device-library-badge', text: 'Local only' }),
    ),
    el('p', { className: 'device-library-description', text: 'Personal EPUBs, covers, settings, and reading progress stay in this browser and are never uploaded to Yomi.' }),
    deviceStorageStatus,
    storageEstimate,
    el('p', { className: 'device-storage-caveat', text: 'Browser storage is managed by your device and can be cleared by browser settings, private browsing, or device cleanup. Download backups regularly to keep a separate copy.' }),
    el('div', { className: 'backup-actions' }, downloadBackup, chooseBackup, restoreButton),
    backupInput,
    backupPreview,
    backupStatus,
  );

  // Storage capability checks are advisory and deliberately run independently
  // from EPUB import so unavailable APIs never block adding a book.
  void updateStorageDetails();

  const updateCoverPreview = () => {
    empty(coverPreview);
    const cover = coverOverride ?? parsed?.coverDataUrl;
    if (cover) {
      coverPreview.className = 'cover-preview';
      coverPreview.appendChild(el('img', { src: cover, alt: 'Selected book cover preview' }));
    } else {
      coverPreview.className = 'cover-preview-empty';
      coverPreview.textContent = 'Cover preview';
    }
  };

  const renderReview = () => {
    empty(review);
    if (!parsed) {
      importButton.disabled = true;
      updateCoverPreview();
      return;
    }
    const cover = coverOverride ?? parsed.coverDataUrl;
    updateCoverPreview();
    review.appendChild(el('section', { className: 'import-review-card' },
      el('div', { className: 'import-review-heading' },
        el('div', {},
          el('p', { className: 'eyebrow', text: 'Ready to import' }),
          el('h3', { text: parsed.title }),
          el('p', { className: 'import-author', text: parsed.author || 'Unknown author' }),
        ),
        el('span', { className: 'import-count-badge', text: `${parsed.chapters.length.toLocaleString()} chapters` }),
      ),
      el('dl', { className: 'import-metadata' },
        el('div', {}, el('dt', { text: 'Language' }), el('dd', { text: languageLabel(parsed.language) })),
        el('div', {}, el('dt', { text: 'Cover' }), el('dd', { text: coverOverride ? selectedCoverName : (cover ? 'From EPUB' : 'No cover selected') })),
      ),
      el('p', { className: 'import-local-note', text: 'Saved on this device and available in your library.' }),
    ));
    importButton.disabled = false;
  };

  const setStatus = (message: string, kind: 'error' | 'success' | 'info' = 'info') => {
    status.textContent = message;
    status.className = `import-status ${kind}`;
  };

  const parseFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      setStatus('Choose an EPUB file to continue.', 'error');
      return;
    }
    parsed = null;
    selectedEpubName = file.name;
    epubFilename.textContent = selectedEpubName;
    setStatus('Reading book details and chapters…');
    renderReview();
    try {
      parsed = await parseEpub(await file.arrayBuffer());
      setStatus('EPUB is ready to review.', 'success');
      renderReview();
    } catch (error) {
      parsed = null;
      renderReview();
      setStatus(`Could not read this EPUB. ${error instanceof Error ? error.message : 'Check the file and try again.'}`, 'error');
    }
  };

  epubInput.addEventListener('change', () => {
    const file = epubInput.files?.[0];
    if (file) void parseFile(file);
  });
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Choose an image file for the cover.', 'error');
      return;
    }
    try {
      coverOverride = await readAsDataUrl(file);
      selectedCoverName = file.name;
      coverFilename.textContent = file.name;
      renderReview();
      setStatus('Custom cover selected.', 'success');
    } catch {
      setStatus('Could not read that image. Choose another cover file.', 'error');
    }
  });

  const epubDropzone = el('div', {
    className: 'import-dropzone',
    ondragover: (event: DragEvent) => { event.preventDefault(); epubDropzone.classList.add('dragover'); },
    ondragleave: () => epubDropzone.classList.remove('dragover'),
    ondrop: (event: DragEvent) => {
      event.preventDefault(); epubDropzone.classList.remove('dragover');
      const file = event.dataTransfer?.files[0];
      if (file) void parseFile(file);
    },
  },
    el('h3', { text: 'Choose your book' }),
    el('p', { text: 'Drop an EPUB here or browse files on your device.' }),
    epubFilename,
    el('button', { className: 'btn btn-secondary import-picker', type: 'button', onclick: () => epubInput.click(), text: 'Browse EPUBs' }),
  );

  const removeCover = el('button', {
    className: 'cover-clear-btn', type: 'button', text: 'Use EPUB cover',
    onclick: () => {
      coverOverride = null;
      selectedCoverName = '';
      coverFilename.textContent = 'Optional · use the cover inside the EPUB';
      coverInput.value = '';
      renderReview();
      setStatus('Using the cover inside the EPUB.', 'info');
    },
  });

  const coverPicker = el('section', { className: 'cover-picker-card' },
    el('div', { className: 'cover-picker-copy' },
      el('p', { className: 'eyebrow', text: 'Optional' }),
      el('h3', { text: 'Add a cover image' }),
      el('p', { text: 'Choose an image to replace the EPUB’s cover.' }),
      coverFilename,
      el('div', { className: 'cover-picker-actions' },
        el('button', { className: 'btn btn-secondary import-picker', type: 'button', onclick: () => coverInput.click(), text: 'Choose image' }),
        removeCover,
      ),
    ),
    coverPreview,
  );

  importButton.addEventListener('click', async () => {
    if (!parsed) return;
    importButton.disabled = true;
    importButton.textContent = 'Adding to library…';
    setStatus('Saving the book on this device…');
    const id = parsed.suggestedId || slugify(parsed.title) || `imported-${Date.now()}`;
    try {
      const existing = await fetchAllNovels();
      if (existing.some(novel => novel.id === id)) {
        setStatus(`“${parsed.title}” is already in your library. Remove the existing entry before importing it again.`, 'error');
        importButton.disabled = false;
        importButton.textContent = 'Add to library';
        return;
      }
      const volId = volumeId(id, 1);
      const chapters: Chapter[] = parsed.chapters.map((chapter, index) => ({
        id: `${id}-ch-${index + 1}`,
        novelId: id,
        volumeId: volId,
        globalChapterNumber: index + 1,
        volumeChapterNumber: index + 1,
        title: chapter.title || `Chapter ${index + 1}`,
        content: chapter.content,
        wordCount: chapter.wordCount,
        metadata: { source: 'epub-import' },
      }));
      const novel: Novel = {
        id,
        title: parsed.title,
        originalTitle: parsed.title,
        alternativeTitles: [],
        author: parsed.author || 'Unknown author',
        description: parsed.description || '',
        cover: coverOverride ?? parsed.coverDataUrl ?? '',
        sourceLanguage: languageLabel(parsed.language),
        translationLanguage: 'English',
        status: 'completed',
        genres: [],
        tags: [],
        volumes: [{ id: volId, novelId: id, volumeNumber: 1, title: 'Complete Edition', chapterCount: chapters.length }],
        chapters: chapters.map(chapter => ({ ...chapter, content: '' })),
        downloads: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveImportedNovel(novel, chapters);
      clearNovelCache();
      empty(review);
      review.appendChild(el('section', { className: 'import-success-card' },
        el('span', { className: 'import-success-mark', 'aria-hidden': 'true', text: '✓' }),
        el('p', { className: 'eyebrow', text: 'Added to your library' }),
        el('h3', { text: novel.title }),
        el('p', { text: `${chapters.length.toLocaleString()} chapters are ready to read.` }),
        el('div', { className: 'import-success-actions' },
          el('button', { className: 'btn btn-primary', type: 'button', onclick: () => router.navigate(`novel/${id}`), text: 'Open book' }),
          el('button', { className: 'btn btn-secondary', type: 'button', onclick: () => router.navigate('library'), text: 'Back to library' }),
        ),
      ));
      setStatus('Import complete.', 'success');
    } catch (error) {
      const isFull = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError');
      setStatus(isFull
        ? 'There is not enough browser storage for this book. Free some device storage and try again.'
        : `The book could not be saved. ${error instanceof Error ? error.message : 'Try again.'}`, 'error');
      importButton.disabled = false;
      importButton.textContent = 'Add to library';
    }
  });

  if (sharedContent) {
    const sharedLink = normalizeSharedUrl(sharedContent.url) ?? normalizeSharedUrl(sharedContent.text);
    mainContainer.appendChild(el('section', { className: 'import-panel share-target-panel', 'aria-labelledby': 'share-target-heading' },
      el('div', { className: 'import-section-heading' },
        el('span', { className: 'step-number', text: '\u2197' }),
        el('h2', { id: 'share-target-heading', text: 'Shared with Yomi' }),
      ),
      sharedContent.title ? el('p', { className: 'share-target-title', text: sharedContent.title }) : null,
      sharedContent.text ? el('p', { className: 'share-target-text', text: sharedContent.text }) : null,
      sharedContent.url ? el('p', { className: 'share-target-url', text: sharedContent.url }) : null,
      sharedLink ? el('a', {
        className: 'btn btn-secondary share-target-open',
        href: sharedLink,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'Open shared link',
      }) : null,
      el('p', { className: 'share-target-note', text: 'Yomi imports books from EPUB files. If you have this title as an EPUB, add it below and it stays on this device.' }),
    ));
  }

  mainContainer.appendChild(el('div', { className: 'admin-container import-page' },
    el('button', { className: 'import-back-link', type: 'button', onclick: () => router.navigate('library'), text: '← Library' }),
    el('header', { className: 'import-page-header' },
      el('p', { className: 'eyebrow', text: 'Your personal collection' }),
      el('h1', { text: 'Add a book' }),
      el('p', { className: 'admin-description', text: 'Bring an EPUB into Yomi and keep reading on this device.' }),
    ),
    el('section', { className: 'import-panel' },
      el('div', { className: 'import-section-heading' }, el('span', { className: 'step-number', text: '01' }), el('h2', { text: 'Choose an EPUB' })),
      epubDropzone,
      epubInput,
    ),
    el('section', { className: 'import-panel cover-import-panel' },
      el('div', { className: 'import-section-heading' }, el('span', { className: 'step-number', text: '02' }), el('h2', { text: 'Choose a cover' })),
      coverPicker,
      coverInput,
    ),
    status,
    review,
    importButton,
    deviceLibraryPanel,
  ));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function languageLabel(code: string): string {
  const normalized = code.trim().toLowerCase();
  const languageNames: Record<string, string> = { en: 'English', eng: 'English', ja: 'Japanese', jp: 'Japanese', zh: 'Chinese', zho: 'Chinese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian' };
  return languageNames[normalized] ?? (code ? code.toUpperCase() : 'Unknown');
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
