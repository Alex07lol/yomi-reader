/* ─── Reader Component ───
   Infinite scroll reader with:
   - IntersectionObserver-based chapter tracking
   - Debounced auto-save to IndexedDB
   - Incremental loading / unloading for memory safety
   - URL deep-linking per chapter
   - Reader settings (font size, line height, width, margin, theme, font)
   - Full keyboard navigation
   - Mobile touch-friendly controls
*/

import { el, empty, debounce, clamp } from '../utils/dom';
import type { Novel, Chapter, ReadingProgress, UserSettings, ReaderLoadingStrategy } from '../models';
import { DEFAULT_SETTINGS, saveReadingProgress, loadUserSettings, saveUserSettings } from '../storage';
import { fetchChapters } from '../data';
import { applyTheme } from '../theme';
import { ChapterDrawer } from './ChapterDrawer';
import { renderSelectMenu } from './SelectMenu';
import { router } from '../utils/router';
import { sanitizeChapterHtml } from '../utils/sanitize-chapter-html.mjs';
import { ChapterDiscussionHost } from './ChapterDiscussion';
import { ReaderSearch } from './ReaderSearch';
import { novelProgressPercent } from '../lib/progress-stats';
import { getCommentCount } from '../community';

export class Reader {
  private container: HTMLElement;
  private mainEl: HTMLElement;
  private readerEl: HTMLElement;
  private contentEl: HTMLElement;
  private toolbarEl: HTMLElement;
  private settingsPanel: HTMLElement;
  private progressEl: HTMLElement;
  private mobileControlsEl: HTMLElement | null = null;

  private novel: Novel | null = null;
  private chapters: Chapter[] = [];
  private settings: UserSettings | null = null;

  // Loaded DOM chapter elements keyed by chapterId
  private loadedChapters = new Map<string, HTMLElement>();
  // Currently visible chapter (tracked by IntersectionObserver)
  private currentChapterId: string | null = null;
  private currentProgress: ReadingProgress | null = null;

  // Scroll restore
  private initialChapterId: string | null = null;
  private initialScrollY: number = 0;
  private hasRestored = false;

  // Loading windows are selected in Reader Settings.

  private observer: IntersectionObserver | null = null;
  private saveDebounced: () => void;
  private drawer: ChapterDrawer;
  private settingsOpen = false;
  private animationFrame: number | null = null;
  private isDestroyed = false;
  private controlsHideTimer: number | null = null;

  // Chapter discussions are optional and independent from reading.
  private discussions = new ChapterDiscussionHost();
  private communityEnabled = true;
  private commentsButton: HTMLButtonElement | null = null;
  private search: ReaderSearch | null = null;
  private novelProgressEl: HTMLElement | null = null;
  private commentsCountRequest = 0;
  private chapterCommentCounts = new Map<string, number>();

  // Mobile sidebar state (reserved for future drawer integration)

  constructor(container: HTMLElement) {
    this.container = container;
    this.drawer = new ChapterDrawer();

    this.saveDebounced = debounce(() => this.saveProgress(), 500);

    this.mainEl = el('div', { className: 'reader-main' });
    this.toolbarEl = el('div', { className: 'reader-toolbar' });
    this.settingsPanel = el('div', { className: 'reader-settings-panel' });
    this.readerEl = el('div', { className: 'reader-container' });
    this.contentEl = el('div', { className: 'reader-content' });
    this.progressEl = el('div', { className: 'reader-progress-bar' });

    this.readerEl.appendChild(this.progressEl);
    this.readerEl.appendChild(this.contentEl);
    this.mainEl.appendChild(this.toolbarEl);
    this.mainEl.appendChild(this.readerEl);
    this.mainEl.appendChild(this.settingsPanel);
    this.container.appendChild(this.mainEl);
  }

  /** Personal imports never join the shared community space. */
  disableCommunity(): void {
    this.communityEnabled = false;
  }

  /* ── Lifecycle ── */

  async load(novel: Novel, initialChapterId?: string, scrollY?: number): Promise<void> {
    if (this.isDestroyed) return;
    this.novel = novel;
    this.initialChapterId = initialChapterId ?? novel.chapters[0]?.id;
    // Adopt the target chapter straight away: the IntersectionObserver refines
    // this as the reader scrolls, but the toolbar indicator, mobile controls and
    // comment count must be correct from the first frame.
    this.currentChapterId = this.initialChapterId ?? null;
    this.initialScrollY = scrollY ?? 0;
    this.hasRestored = false;
    this.settings = await loadUserSettings();

    this.chapters = await fetchChapters(novel.id);
    this.applySettings();
    this.renderToolbar();
    this.setupSearch();
    this.renderMobileControls();
    this.loadInitialChapters();
    this.setupObserver();
    this.setupScrollListener();
    this.setupKeyboardNav();
    this.setupTouchNav();
    this.setupControlAutoHide();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.search?.dispose();
    this.search = null;
    this.discussions.disposeAll();
    this.observer?.disconnect();
    this.observer = null;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.controlsHideTimer !== null) window.clearTimeout(this.controlsHideTimer);
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
    }
    empty(this.container);
  }

  /* ── Keyboard Navigation ── */

  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private setupKeyboardNav(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.navigatePrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.navigateNext();
          break;
        case 'Home':
          e.preventDefault();
          this.goToFirstChapter();
          break;
        case 'End':
          e.preventDefault();
          this.goToLastChapter();
          break;
        case 'Escape':
          e.preventDefault();
          this.drawer.close();
          break;
        case 'f':
        case 'F':
          // Ctrl/Cmd+F and a bare "f" both open the in-reader search.
          if (!e.altKey) {
            e.preventDefault();
            this.openSearch();
          }
          break;
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  /* ── Touch Navigation (swipe) ── */

  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;

  private setupTouchNav(): void {
    this.readerEl.addEventListener('touchstart', (e) => {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartTime = Date.now();
    }, { passive: true });

    this.readerEl.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - this.touchStartX;
      const dy = e.changedTouches[0].clientY - this.touchStartY;
      const dt = Date.now() - this.touchStartTime;

      // Only trigger for horizontal swipes > 50px, < 500ms
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
      if (dt > 500) return;

      if (dx < -50) {
        this.navigateNext();
      } else if (dx > 50) {
        this.navigatePrevious();
      }
    }, { passive: true });
  }

  /* ── Mobile Controls ── */

  private renderMobileControls(): void {
    if (!this.novel) return;

    const existing = this.container.querySelector('.reader-mobile-controls');
    if (existing) return;

    const controls = el('div', { className: 'reader-mobile-controls' },
      el('button', {
        className: 'mobile-btn mobile-prev',
        'aria-label': 'Previous chapter',
        onclick: () => this.navigatePrevious(),
      }, 'Previous'),
      el('span', { className: 'reader-current-chapter', id: 'chapter-indicator', 'aria-live': 'polite', text: 'Chapter 1' }),
      el('button', {
        className: 'mobile-btn mobile-next',
        'aria-label': 'Next chapter',
        onclick: () => this.navigateNext(),
      }, 'Next'),
    );

    this.container.appendChild(controls);
    this.mobileControlsEl = controls;
  }

  private updateMobileControls(): void {
    if (!this.mobileControlsEl) return;
    const prevBtn = this.mobileControlsEl.querySelector('.mobile-prev') as HTMLElement | null;
    const nextBtn = this.mobileControlsEl.querySelector('.mobile-next') as HTMLElement | null;
    if (!this.novel) return;

    const currentIdx = this.chapters.findIndex(c => c.id === this.currentChapterId);
    if (prevBtn) prevBtn.style.visibility = currentIdx > 0 ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = currentIdx < this.chapters.length - 1 ? 'visible' : 'hidden';
    const current = this.chapters[currentIdx];
    const indicator = this.mobileControlsEl.querySelector('.reader-current-chapter');
    if (indicator && current) indicator.textContent = current.title || `Chapter ${current.globalChapterNumber}`;
  }

  /* ── Navigation ── */

  private navigatePrevious(): void {
    if (!this.novel) return;
    const idx = this.chapters.findIndex(c => c.id === this.currentChapterId);
    if (idx <= 0) return;
    const prev = this.chapters[idx - 1];
    this.navigateToChapter(prev.id);
  }

  private navigateNext(): void {
    if (!this.novel) return;
    const idx = this.chapters.findIndex(c => c.id === this.currentChapterId);
    if (idx < 0 || idx >= this.chapters.length - 1) return;
    const next = this.chapters[idx + 1];
    this.navigateToChapter(next.id);
  }

  private goToFirstChapter(): void {
    if (!this.novel || this.chapters.length === 0) return;
    this.navigateToChapter(this.chapters[0].id);
  }

  private goToLastChapter(): void {
    if (!this.novel || this.chapters.length === 0) return;
    this.navigateToChapter(this.chapters[this.chapters.length - 1].id);
  }

  private setupSearch(): void {
    this.search?.dispose();
    this.search = new ReaderSearch({
      getChapters: () => this.chapters,
      getCurrentChapterId: () => this.currentChapterId ?? this.initialChapterId ?? null,
      getChapterContentElement: (chapterId) =>
        this.loadedChapters.get(chapterId)?.querySelector<HTMLElement>('.chapter-block-content') ?? null,
      navigateToChapter: (chapterId) => this.navigateToChapter(chapterId),
    });
    this.mainEl.appendChild(this.search.element);
  }

  private openSearch(): void {
    if (!this.search) this.setupSearch();
    this.search?.open();
  }

  /** How far into a chapter block the top of the viewport currently is. */
  private computeVisibleFraction(block: HTMLElement): number {
    const totalHeight = block.scrollHeight || block.getBoundingClientRect().height;
    if (totalHeight <= 0) return 0;
    const visibleStart = this.readerEl.getBoundingClientRect().top - block.getBoundingClientRect().top;
    return clamp(visibleStart / totalHeight, 0, 0.99);
  }

  /** Updates the toolbar's whole-book progress indicator. */
  private updateNovelProgress(): void {
    if (!this.novelProgressEl || !this.novel) return;
    const chapterId = this.currentChapterId ?? this.initialChapterId;
    const block = chapterId ? this.loadedChapters.get(chapterId) : null;
    const fraction = block ? this.computeVisibleFraction(block) : 0;
    const percent = novelProgressPercent(this.chapters, chapterId ? { chapterId, progress: fraction } : null);
    const fill = this.novelProgressEl.querySelector<HTMLElement>('.reader-novel-progress-fill');
    const label = this.novelProgressEl.querySelector<HTMLElement>('.reader-novel-progress-label');
    const track = this.novelProgressEl.querySelector<HTMLElement>('.reader-novel-progress-track');
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = `${percent}%`;
    if (track) track.setAttribute('aria-label', `${percent}% of ${this.novel.title} read`);
  }

  /* ── Rendering ── */

  private renderToolbar(): void {
    empty(this.toolbarEl);

    if (!this.novel) return;

    // A persistent progress indicator: how far through the whole book this is,
    // not just the loaded scroll window. It lives inside the toolbar's center
    // pill so it stays visible in both the default and redesigned layouts.
    const progress = el('div', { className: 'reader-novel-progress' },
      el('span', {
        className: 'reader-novel-progress-track',
        'aria-hidden': 'true',
        'aria-label': `0% of ${this.novel.title} read`,
      }, el('span', { className: 'reader-novel-progress-fill' })),
      el('span', { className: 'reader-novel-progress-label', text: '0%' }),
    );
    this.novelProgressEl = progress;

    const center = el('div', { className: 'toolbar-center' },
      el('span', { className: 'reader-novel-name', text: this.novel.title }),
      progress,
    );

    const right = el('div', { className: 'toolbar-right' },
      el('button', {
        className: 'toolbar-btn reader-search-btn',
        type: 'button',
        'aria-label': 'Search this book',
        onclick: () => this.openSearch(),
      }, el('span', { className: 'reader-search-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/></svg>' })),
      (this.communityEnabled && this.discussions.enabled) ? el('button', {
        className: 'toolbar-btn reader-comments-btn',
        type: 'button',
        hidden: true,
        'aria-label': 'Open chapter comments',
        onclick: () => this.openComments(),
      },
        el('span', { className: 'reader-comments-icon', 'aria-hidden': 'true', text: '💬' }),
        el('span', { className: 'reader-comments-count', 'aria-hidden': 'true' }),
      ) as HTMLButtonElement : null,
      el('button', {
        className: 'toolbar-btn reader-home-btn',
        'aria-label': 'Go to library',
        onclick: () => router.navigate('library'),
      }, el('span', {
        className: 'reader-home-icon',
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 10.5 12 3.75l8.5 6.75"/><path d="M5.5 9.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10M9.5 20.5v-6h5v6"/></svg>',
      })),
      el('button', {
        className: 'toolbar-btn',
        'aria-label': 'Open chapter navigation',
        onclick: () => this.drawer.toggle(
          this.novel!, this.chapters,
          this.currentChapterId ?? this.initialChapterId ?? '',
          (chId) => this.navigateToChapter(chId),
        ),
      }, '☰'),
      el('button', {
        className: 'toolbar-btn',
        'aria-label': 'Reader settings',
        onclick: () => this.toggleSettings(),
      }, 'Aa'),
    );

    this.toolbarEl.appendChild(center);
    this.toolbarEl.appendChild(right);
    this.commentsButton = this.toolbarEl.querySelector<HTMLButtonElement>('.reader-comments-btn');
    void this.updateCommentsCount();
    this.updateNovelProgress();
  }

  private renderSettings(): void {
    if (!this.settings) return;
    empty(this.settingsPanel);

    const s = this.settings;

    const createSlider = (label: string, value: number, min: number, max: number, step: number, unit: string, onChange: (v: number) => void) => {
      const row = el('div', { className: 'settings-row' },
        el('label', { className: 'settings-label', text: `${label}: ${value}${unit}` }),
        el('input', {
          type: 'range',
          min: String(min), max: String(max), step: String(step),
          value: String(value),
          'aria-label': label,
          oninput: (e: Event) => {
            const v = parseInt((e.target as HTMLInputElement).value);
            onChange(v);
            const labelEl = (e.target as HTMLElement).parentElement?.querySelector('.settings-label');
            if (labelEl) labelEl.textContent = `${label}: ${v}${unit}`;
          },
        }),
      );
      return row;
    };

    this.settingsPanel.appendChild(
      el('div', { className: 'settings-panel-header' },
        el('h3', { text: 'Reader Settings' }),
        el('button', {
          className: 'toolbar-btn',
          'aria-label': 'Close settings',
          onclick: () => this.toggleSettings(),
        }, '✕'),
      ),
    );

    this.settingsPanel.appendChild(el('div', { className: 'settings-section-title', text: 'Chapter loading' }));
    this.settingsPanel.appendChild(el('div', { className: 'settings-row settings-toggle-row' },
      el('label', { className: 'settings-label', for: 'infinite-scroll-setting', text: 'Infinite scroll' }),
      el('input', {
        id: 'infinite-scroll-setting', type: 'checkbox', checked: s.infiniteScroll,
        'aria-label': 'Infinite scroll',
        onchange: (e: Event) => void this.updateLoadingConfiguration({ infiniteScroll: (e.target as HTMLInputElement).checked }),
      }),
    ));

    this.settingsPanel.appendChild(el('div', { className: 'settings-row' },
      el('label', { className: 'settings-label', text: 'Loading strategy' }),
      renderSelectMenu('Loading strategy', s.readerLoadingStrategy, [
        { value: 'balanced', label: 'Balanced · nearby chapters' },
        { value: 'lightweight', label: 'Low memory · load fewer' },
        { value: 'preload', label: 'Preload ahead · smoother reading' },
      ], value => void this.updateLoadingConfiguration({ readerLoadingStrategy: value as ReaderLoadingStrategy }), 'reader-select-menu', '', !s.infiniteScroll),
    ));

    this.settingsPanel.appendChild(createSlider('Font Size', s.fontSize, 12, 32, 1, 'px', (v) => {
      s.fontSize = v; this.applyReaderStyles(); this.saveSettings();
    }));

    this.settingsPanel.appendChild(createSlider('Line Height', Math.round(s.lineHeight * 10), 10, 30, 1, '', (v) => {
      s.lineHeight = v / 10; this.applyReaderStyles(); this.saveSettings();
    }));

    this.settingsPanel.appendChild(createSlider('Reading Width', s.readingWidth, 480, 960, 10, 'px', (v) => {
      s.readingWidth = v; this.applyReaderStyles(); this.saveSettings();
    }));

    this.settingsPanel.appendChild(createSlider('Margin', s.pageMargin, 8, 48, 4, 'px', (v) => {
      s.pageMargin = v; this.applyReaderStyles(); this.saveSettings();
    }));

    const fontRow = el('div', { className: 'settings-row' },
      el('label', { className: 'settings-label', text: 'Font' }),
      renderSelectMenu('Font family', s.fontFamily, [
        { value: 'serif', label: 'Serif (Georgia)' },
        { value: 'sans', label: 'Sans-serif (Inter)' },
        { value: 'mono', label: 'Monospace' },
      ], value => {
          s.fontFamily = value;
          this.applyReaderStyles();
          this.saveSettings();
        }, 'reader-select-menu'),
    );
    this.settingsPanel.appendChild(fontRow);

    const alignRow = el('div', { className: 'settings-row' },
      el('label', { className: 'settings-label', text: 'Text alignment' }),
      renderSelectMenu('Text alignment', s.textAlign, [
        { value: 'left', label: 'Left' },
        { value: 'justify', label: 'Justified' },
      ], value => {
          s.textAlign = value === 'justify' ? 'justify' : 'left';
          this.applyReaderStyles();
          this.saveSettings();
        }, 'reader-select-menu'),
    );
    this.settingsPanel.appendChild(alignRow);

    this.settingsPanel.appendChild(createSlider('Paragraph spacing', Math.round(s.paragraphSpacing * 10), 6, 24, 1, '', (v) => {
      s.paragraphSpacing = v / 10; this.applyReaderStyles(); this.saveSettings();
    }));

    this.settingsPanel.appendChild(createSlider('Letter spacing', Math.round(s.letterSpacing * 10), 0, 30, 1, '', (v) => {
      s.letterSpacing = v / 10; this.applyReaderStyles(); this.saveSettings();
    }));

    this.settingsPanel.appendChild(el('div', { className: 'settings-row settings-reset-row' },
      el('button', {
        className: 'settings-reset-button',
        type: 'button',
        text: 'Reset reading style',
        onclick: () => void this.resetReaderStyles(),
      }),
      el('span', {
        className: 'settings-reset-hint',
        text: 'Restores font, spacing and alignment defaults.',
      }),
    ));
  }

  /** Restores the typography defaults without touching theme or loading mode. */
  private async resetReaderStyles(): Promise<void> {
    if (!this.settings) return;
    this.settings = {
      ...this.settings,
      fontSize: DEFAULT_SETTINGS.fontSize,
      lineHeight: DEFAULT_SETTINGS.lineHeight,
      readingWidth: DEFAULT_SETTINGS.readingWidth,
      pageMargin: DEFAULT_SETTINGS.pageMargin,
      fontFamily: DEFAULT_SETTINGS.fontFamily,
      textAlign: DEFAULT_SETTINGS.textAlign,
      paragraphSpacing: DEFAULT_SETTINGS.paragraphSpacing,
      letterSpacing: DEFAULT_SETTINGS.letterSpacing,
    };
    this.applyReaderStyles();
    await this.saveSettings();
    this.renderSettings();
    this.settingsPanel.classList.add('open');
  }

  private setupControlAutoHide(): void {
    const hide = () => this.mainEl.classList.add('reader-controls-hidden');
    const reveal = () => {
      if (this.controlsHideTimer !== null) window.clearTimeout(this.controlsHideTimer);
      this.mainEl.classList.remove('reader-controls-hidden');
      this.controlsHideTimer = window.setTimeout(hide, 2400);
    };
    this.readerEl.addEventListener('scroll', () => {
      if (this.controlsHideTimer !== null) window.clearTimeout(this.controlsHideTimer);
      hide();
      this.controlsHideTimer = window.setTimeout(reveal, 700);
    }, { passive: true });
    this.mainEl.addEventListener('pointermove', reveal);
    this.mainEl.addEventListener('touchstart', reveal, { passive: true });
    this.mainEl.addEventListener('keydown', reveal);
    reveal();
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    if (this.settingsOpen) {
      this.renderSettings();
      this.settingsPanel.classList.add('open');
    } else {
      this.settingsPanel.classList.remove('open');
    }
  }

  private async updateLoadingConfiguration(
    patch: Partial<Pick<UserSettings, 'infiniteScroll' | 'readerLoadingStrategy'>>,
  ): Promise<void> {
    if (!this.settings) return;
    const currentChapterId = this.currentChapterId ?? this.initialChapterId;
    Object.assign(this.settings, patch);
    await this.saveSettings();
    if (currentChapterId) {
      this.initialChapterId = currentChapterId;
      this.initialScrollY = 0;
      this.hasRestored = false;
      this.observer?.disconnect();
      this.observer = null;
      this.loadInitialChapters();
      this.setupObserver();
    }
    this.renderSettings();
    this.settingsPanel.classList.add('open');
  }

  private getLoadingWindow(): { ahead: number; behind: number; unloadDistance: number } {
    switch (this.settings?.readerLoadingStrategy) {
      case 'lightweight': return { ahead: 2, behind: 0, unloadDistance: 5 };
      case 'preload': return { ahead: 10, behind: 2, unloadDistance: 30 };
      default: return { ahead: 5, behind: 3, unloadDistance: 15 };
    }
  }

  /* ── Styling ── */

  private applySettings(): void {
    applyTheme(this.settings?.theme ?? 'midnight');
    this.applyReaderStyles();
  }

  private applyReaderStyles(): void {
    if (!this.settings) return;
    const s = this.settings;
    this.readerEl.style.setProperty('--reader-width', `${s.readingWidth}px`);
    this.readerEl.style.setProperty('--reader-padding', `${s.pageMargin}px`);
    this.readerEl.style.setProperty('--reader-paragraph-spacing', `${s.paragraphSpacing}em`);
    this.contentEl.style.fontSize = `${s.fontSize}px`;
    this.contentEl.style.lineHeight = String(s.lineHeight);
    this.contentEl.style.letterSpacing = `${s.letterSpacing}px`;
    this.contentEl.style.textAlign = s.textAlign === 'justify' ? 'justify' : 'left';
    this.contentEl.style.fontFamily = s.fontFamily === 'serif'
      ? 'var(--font-serif)'
      : s.fontFamily === 'mono' ? 'var(--font-mono, ui-monospace, monospace)' : 'var(--font-sans)';
  }

  private async saveSettings(): Promise<void> {
    if (!this.settings) return;
    await saveUserSettings(this.settings);
  }

  /* ── Chapter Loading ── */

  private loadInitialChapters(): void {
    // Rebuilding the window removes every chapter block; dispose their
    // discussion regions too so reopened chapters can mount again cleanly.
    this.discussions.disposeAll();
    empty(this.contentEl);
    this.loadedChapters.clear();

    if (!this.novel || this.chapters.length === 0) return;

    const startIdx = this.initialChapterId
      ? this.chapters.findIndex(c => c.id === this.initialChapterId)
      : 0;
    const start = Math.max(0, Math.min(startIdx, this.chapters.length - 1));

    const { ahead, behind } = this.getLoadingWindow();
    const end = this.settings?.infiniteScroll ? Math.min(start + ahead + 1, this.chapters.length) : start + 1;
    const loadStart = this.settings?.infiniteScroll ? Math.max(0, start - behind) : start;

    for (let i = loadStart; i < end; i++) {
      this.appendChapter(this.chapters[i]);
    }

    requestAnimationFrame(() => {
      if (this.initialScrollY > 0 && !this.hasRestored) {
        this.readerEl.scrollTop = this.initialScrollY;
        this.hasRestored = true;
      } else if (this.initialChapterId && !this.hasRestored) {
        const el = this.loadedChapters.get(this.initialChapterId!);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        this.hasRestored = true;
      }
      this.updateMobileControls();
      this.updateNovelProgress();
      this.search?.refresh();
      void this.updateCommentsCount();
    });
  }

  private appendChapter(chapter: Chapter, prepend = false): void {
    if (this.loadedChapters.has(chapter.id)) return;

    const block = el('article', {
      className: 'chapter-block',
      'data-chapter-id': chapter.id,
      'data-chapter-number': String(chapter.globalChapterNumber),
      'data-novel-id': chapter.novelId,
      'data-volume-id': chapter.volumeId,
    },
      el('div', { className: 'chapter-block-header' },
        el('h2', { className: 'chapter-block-title', text: chapter.title || `Chapter ${chapter.globalChapterNumber}` }),
        el('span', { className: 'chapter-block-number', text: `Chapter ${chapter.globalChapterNumber}` }),
      ),
      el('div', { className: 'chapter-block-content', html: sanitizeChapterHtml(chapter.content) }),
      el('div', { className: 'chapter-block-footer' },
        el('span', { className: 'chapter-block-wordcount', text: `${chapter.wordCount.toLocaleString()} words` }),
      ),
    );

    if (prepend) this.contentEl.insertBefore(block, this.contentEl.firstChild);
    else this.contentEl.appendChild(block);
    if (this.communityEnabled) this.discussions.mount(chapter, block);
    this.loadedChapters.set(chapter.id, block);

    if (this.observer) {
      this.observer.observe(block);
    }
  }

  private removeChapter(chapterId: string): void {
    this.discussions.dispose(chapterId);
    const block = this.loadedChapters.get(chapterId);
    if (block) {
      if (this.observer) this.observer.unobserve(block);
      block.remove();
      this.loadedChapters.delete(chapterId);
    }
  }

  private loadNearbyChapters(): void {
    if (!this.novel || this.chapters.length === 0 || !this.settings?.infiniteScroll) return;

    const visibleIds = this.getVisibleChapterIds();
    if (visibleIds.length === 0) return;

    const minIdx = Math.min(...visibleIds.map(id => this.chapters.findIndex(c => c.id === id)).filter(i => i >= 0));
    const maxIdx = Math.max(...visibleIds.map(id => this.chapters.findIndex(c => c.id === id)).filter(i => i >= 0));

    const { ahead, behind, unloadDistance } = this.getLoadingWindow();
    const previousHeight = this.readerEl.scrollHeight;
    for (let i = minIdx - 1; i >= Math.max(0, minIdx - behind); i--) {
      const chapter = this.chapters[i];
      if (chapter) this.appendChapter(chapter, true);
    }
    this.readerEl.scrollTop += this.readerEl.scrollHeight - previousHeight;
    for (let i = maxIdx + 1; i <= Math.min(maxIdx + ahead, this.chapters.length - 1); i++) {
      this.appendChapter(this.chapters[i]);
    }

    if (this.loadedChapters.size > unloadDistance * 2) {
      const loadedIds = [...this.loadedChapters.keys()];
      for (const id of loadedIds) {
        const idx = this.chapters.findIndex(c => c.id === id);
        if (idx >= 0 && (idx < minIdx - unloadDistance || idx > maxIdx + unloadDistance)) {
          this.removeChapter(id);
        }
      }
    }

    this.updateMobileControls();
  }

  private getVisibleChapterIds(): string[] {
    const blocks = this.contentEl.querySelectorAll('.chapter-block');
    const readerRect = this.readerEl.getBoundingClientRect();
    const ids: string[] = [];

    blocks.forEach(block => {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > readerRect.top && rect.top < readerRect.bottom) {
        ids.push((block as HTMLElement).getAttribute('data-chapter-id')!);
      }
    });

    return ids;
  }

  /* ── Intersection Observer for Chapter Tracking ── */

  private setupObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }

        if (bestEntry) {
          const target = bestEntry.target as HTMLElement;
          const id = target.getAttribute('data-chapter-id');
          const num = target.getAttribute('data-chapter-number');
          if (id) {
            this.currentChapterId = id;
            this.updateChapterIndicator(num ? `Chapter ${num}` : '');
            this.updateUrl(id);
            this.saveDebounced();
            this.loadNearbyChapters();
            this.updateNovelProgress();
            void this.updateCommentsCount();
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    this.loadedChapters.forEach(block => this.observer?.observe(block));
  }

  private setupScrollListener(): void {
    let ticking = false;
    this.readerEl.addEventListener('scroll', () => {
      if (!ticking) {
        this.animationFrame = requestAnimationFrame(() => {
          this.updateProgressBar();
          this.updateNovelProgress();
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  private updateProgressBar(): void {
    const scrollTop = this.readerEl.scrollTop;
    const scrollHeight = this.readerEl.scrollHeight - this.readerEl.clientHeight;
    const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    this.progressEl.style.width = `${clamp(pct, 0, 100)}%`;
  }

  private updateChapterIndicator(text: string): void {
    const indicator = document.getElementById('chapter-indicator');
    if (indicator) indicator.textContent = text;
  }

  private updateUrl(chapterId: string): void {
    if (!this.novel) return;
    const newHash = `reader/${this.novel.id}/${chapterId}`;
    if (window.location.hash.slice(1) !== newHash) {
      history.replaceState(null, '', `#${newHash}`);
    }
  }

  /* ── Navigation ── */

  navigateToChapter(chapterId: string): void {
    const block = this.loadedChapters.get(chapterId);
    if (block) {
      this.currentChapterId = chapterId;
      block.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.updateNovelProgress();
      this.updateMobileControls();
      this.saveDebounced();
      void this.updateCommentsCount();
      return;
    }

    const idx = this.chapters.findIndex(c => c.id === chapterId);
    if (idx >= 0) {
      this.initialChapterId = chapterId;
      this.currentChapterId = chapterId;
      this.initialScrollY = 0;
      this.hasRestored = false;
      this.observer?.disconnect();
      this.observer = null;
      this.loadInitialChapters();
      this.setupObserver();
    }
  }

  /* ── Progress Saving ── */

  private async saveProgress(): Promise<void> {
    if (!this.novel || !this.currentChapterId) return;

    const chapter = this.chapters.find(c => c.id === this.currentChapterId);
    if (!chapter) return;

    const block = this.loadedChapters.get(this.currentChapterId);
    let progress = 0;
    let scrollPosition = 0;

    if (block) {
      progress = this.computeVisibleFraction(block);
      const contentScroll = this.readerEl.scrollTop - block.offsetTop;
      scrollPosition = Math.max(0, contentScroll);
    }

    const readingProgress: ReadingProgress = {
      novelId: this.novel.id,
      chapterId: chapter.id,
      globalChapterNumber: chapter.globalChapterNumber,
      volumeId: chapter.volumeId,
      progress,
      scrollPosition,
      lastRead: Date.now(),
      completed: progress >= 0.95,
    };

    this.currentProgress = readingProgress;
    await saveReadingProgress(readingProgress);
  }

  /* ── Chapter discussions ── */

  private openComments(): void {
    const chapterId = this.currentChapterId ?? this.initialChapterId;
    if (!chapterId) return;
    this.discussions.open(chapterId);
  }

  private async updateCommentsCount(): Promise<void> {
    const button = this.commentsButton;
    if (!button || !this.communityEnabled || !this.discussions.enabled || !this.novel) {
      if (button) button.hidden = true;
      return;
    }
    const chapterId = this.currentChapterId;
    const cacheKey = chapterId ?? '';
    if (!chapterId) {
      button.hidden = true;
      return;
    }
    button.hidden = false;

    const cached = this.chapterCommentCounts.get(cacheKey);
    if (cached !== undefined) {
      this.renderCommentsCount(cached);
      return;
    }

    const request = ++this.commentsCountRequest;
    try {
      const count = await getCommentCount({ novelId: this.novel.id, chapterId });
      this.chapterCommentCounts.set(cacheKey, count);
      if (request !== this.commentsCountRequest) return;
      this.renderCommentsCount(count);
    } catch {
      // Community counts are optional; the button still opens the thread.
    }
  }

  private renderCommentsCount(count: number): void {
    const button = this.commentsButton;
    if (!button) return;
    button.hidden = false;
    const badge = button.querySelector('.reader-comments-count');
    if (badge) badge.textContent = count > 0 ? String(count) : '';
    button.setAttribute('aria-label', count > 0 ? `Open chapter comments (${count})` : 'Open chapter comments');
  }

  public async getCurrentProgress(): Promise<ReadingProgress | null> {
    await this.saveProgress();
    return this.currentProgress;
  }
}
