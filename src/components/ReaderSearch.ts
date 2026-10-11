/* ─── In-reader search panel ───
   Find-in-chapter and "search this book" with next/previous navigation and
   match highlighting. The whole index is client-side: it reads the chapter HTML
   the reader already loaded and only touches text nodes. */

import { el, empty, debounce } from '../utils/dom';
import type { Chapter } from '../models';
import {
  activateMatch,
  clearSearchHighlights,
  highlightMatches,
  searchChapters,
  type NovelSearchResult,
} from '../lib/reader-search';

export interface ReaderSearchHost {
  /** Every chapter of the current novel (title, number and HTML content). */
  getChapters(): Chapter[];
  getCurrentChapterId(): string | null;
  /** The rendered content element for a loaded chapter, if any. */
  getChapterContentElement(chapterId: string): HTMLElement | null;
  navigateToChapter(chapterId: string): void;
}

type SearchScope = 'chapter' | 'novel';

export class ReaderSearch {
  readonly element: HTMLElement;
  private readonly host: ReaderSearchHost;
  private readonly input: HTMLInputElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly resultsHost: HTMLElement;
  private readonly runDebounced: () => void;

  private marks: HTMLElement[] = [];
  private activeIndex = -1;
  private open_ = false;
  private scope: SearchScope = 'chapter';
  private lastChapterId: string | null = null;

  constructor(host: ReaderSearchHost) {
    this.host = host;

    this.input = el('input', {
      type: 'search',
      className: 'reader-search-input',
      placeholder: 'Search this book…',
      'aria-label': 'Search text in this book or chapter',
      oninput: () => this.runDebounced(),
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.step(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.close();
        }
      },
    }) as HTMLInputElement;

    this.scopeSelect = el('select', {
      className: 'reader-search-scope community-select community-select-sm',
      'aria-label': 'Search scope',
      onchange: () => {
        this.scope = this.scopeSelect.value === 'novel' ? 'novel' : 'chapter';
        this.run();
      },
    },
      el('option', { value: 'chapter', text: 'This chapter' }),
      el('option', { value: 'novel', text: 'Whole book' }),
    ) as HTMLSelectElement;

    this.statusEl = el('span', { className: 'reader-search-status', role: 'status', 'aria-live': 'polite' });

    this.prevBtn = el('button', {
      className: 'toolbar-btn reader-search-step',
      type: 'button',
      'aria-label': 'Previous match',
      text: '↑',
      onclick: () => this.step(-1),
    }) as HTMLButtonElement;

    this.nextBtn = el('button', {
      className: 'toolbar-btn reader-search-step',
      type: 'button',
      'aria-label': 'Next match',
      text: '↓',
      onclick: () => this.step(1),
    }) as HTMLButtonElement;

    this.resultsHost = el('div', { className: 'reader-search-results', hidden: true });

    this.element = el('div', {
      className: 'reader-search-panel',
      role: 'search',
      hidden: true,
      'aria-label': 'Search',
    },
      el('div', { className: 'reader-search-header' },
        el('span', { className: 'reader-search-title', text: 'Search' }),
        el('button', {
          className: 'toolbar-btn',
          type: 'button',
          'aria-label': 'Close search',
          text: '✕',
          onclick: () => this.close(),
        }),
      ),
      this.input,
      el('div', { className: 'reader-search-controls' },
        this.scopeSelect,
        this.prevBtn,
        this.nextBtn,
        this.statusEl,
      ),
      this.resultsHost,
    );

    this.runDebounced = debounce(() => this.run(), 160);
    this.element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.close();
    });
    this.setNavEnabled(false);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    this.open_ = true;
    this.element.hidden = false;
    this.input.focus();
    this.input.select();
    this.run();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.element.hidden = true;
    this.clearHighlights();
    empty(this.resultsHost);
    this.resultsHost.hidden = true;
    this.setStatus('');
    this.setNavEnabled(false);
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** Re-runs the current search, e.g. after the reader rebuilt its window. */
  refresh(): void {
    if (this.open_) this.run();
  }

  dispose(): void {
    this.clearHighlights();
    this.element.remove();
  }

  private currentContentRoot(): HTMLElement | null {
    const chapterId = this.host.getCurrentChapterId();
    if (!chapterId) return null;
    this.lastChapterId = chapterId;
    return this.host.getChapterContentElement(chapterId);
  }

  private clearHighlights(): void {
    const root = this.lastChapterId ? this.host.getChapterContentElement(this.lastChapterId) : null;
    if (root) clearSearchHighlights(root);
    this.marks = [];
    this.activeIndex = -1;
  }

  private run(): void {
    const query = this.input.value.trim();
    empty(this.resultsHost);
    this.resultsHost.hidden = true;

    if (!query) {
      this.clearHighlights();
      this.setStatus('');
      this.setNavEnabled(false);
      return;
    }

    if (this.scope === 'novel') {
      this.clearHighlights();
      this.setNavEnabled(false);
      const results = searchChapters(this.host.getChapters(), query);
      if (results.length === 0) {
        this.setStatus('No matches in this book');
        return;
      }
      const total = results.reduce((sum, result) => sum + result.matchCount, 0);
      this.setStatus(`${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'chapter' : 'chapters'}`);
      this.renderResults(results, query);
      return;
    }

    const root = this.currentContentRoot();
    if (!root) {
      this.clearHighlights();
      this.setNavEnabled(false);
      this.setStatus('This chapter is not loaded');
      return;
    }
    this.marks = highlightMatches(root, query);
    if (this.marks.length === 0) {
      this.activeIndex = -1;
      this.setNavEnabled(false);
      this.setStatus('No matches in this chapter');
      return;
    }
    this.activeIndex = activateMatch(this.marks, 0);
    this.setNavEnabled(true);
    this.setStatus(`${this.activeIndex + 1} / ${this.marks.length}`);
  }

  private renderResults(results: NovelSearchResult[], query: string): void {
    this.resultsHost.hidden = false;
    for (const result of results) {
      this.resultsHost.appendChild(el('button', {
        className: 'reader-search-result',
        type: 'button',
        onclick: () => this.jumpToResult(result, query),
      },
        el('span', { className: 'reader-search-result-head' },
          el('span', { className: 'reader-search-result-chapter', text: `${result.chapterNumber}. ${result.chapterTitle}` }),
          el('span', { className: 'reader-search-result-count', text: `${result.matchCount}` }),
        ),
        el('span', { className: 'reader-search-result-snippet', text: result.snippet }),
      ));
    }
  }

  private jumpToResult(result: NovelSearchResult, query: string): void {
    this.host.navigateToChapter(result.chapterId);
    // The reader rebuilds the chapter window synchronously, so the freshly
    // rendered chapter is available immediately after navigating.
    this.scope = 'chapter';
    this.scopeSelect.value = 'chapter';
    const root = this.host.getChapterContentElement(result.chapterId);
    if (!root) return;
    this.lastChapterId = result.chapterId;
    this.marks = highlightMatches(root, query);
    if (this.marks.length === 0) {
      this.setStatus('No matches in this chapter');
      this.setNavEnabled(false);
      return;
    }
    this.activeIndex = activateMatch(this.marks, result.matchIndex);
    this.setNavEnabled(true);
    this.setStatus(`${this.activeIndex + 1} / ${this.marks.length}`);
  }

  private step(delta: number): void {
    if (this.marks.length === 0) return;
    this.activeIndex = activateMatch(this.marks, this.activeIndex + delta);
    this.setNavEnabled(true);
    this.setStatus(`${this.activeIndex + 1} / ${this.marks.length}`);
  }

  private setNavEnabled(enabled: boolean): void {
    this.prevBtn.disabled = !enabled;
    this.nextBtn.disabled = !enabled;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
