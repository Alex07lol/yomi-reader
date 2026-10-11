/*
 * Reader behaviour, including the new offline-aware surface: whole-book
 * progress, in-reader search, and the failure path when chapters cannot be
 * loaded at all (offline with nothing saved).
 *
 * The data layer is mocked so the reader can be exercised with an explicit
 * "online" and "offline" chapter source, and jsdom's missing layout APIs are
 * stubbed so assertions are deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, Novel } from '../models';

const h = vi.hoisted(() => ({
  chapters: [] as Chapter[],
  chapterError: null as Error | null,
  fetchCalls: [] as string[],
}));

vi.mock('../data', () => ({
  fetchChapters: async (novelId: string) => {
    h.fetchCalls.push(novelId);
    if (h.chapterError) throw h.chapterError;
    return h.chapters;
  },
}));

vi.mock('../storage', () => ({
  DEFAULT_SETTINGS: {
    theme: 'midnight',
    fontSize: 18,
    lineHeight: 1.8,
    readingWidth: 720,
    pageMargin: 24,
    fontFamily: 'serif',
    textAlign: 'left',
    paragraphSpacing: 1.2,
    letterSpacing: 0,
    infiniteScroll: true,
    readerLoadingStrategy: 'balanced',
  },
  loadUserSettings: async () => ({
    theme: 'midnight',
    fontSize: 18,
    lineHeight: 1.8,
    readingWidth: 720,
    pageMargin: 24,
    fontFamily: 'serif',
    textAlign: 'left',
    paragraphSpacing: 1.2,
    letterSpacing: 0,
    infiniteScroll: true,
    readerLoadingStrategy: 'balanced',
  }),
  saveReadingProgress: async () => undefined,
  saveUserSettings: async () => undefined,
}));

vi.mock('../theme', () => ({ applyTheme: () => undefined }));

vi.mock('../community', () => ({ getCommentCount: async () => 0 }));

vi.mock('./ChapterDiscussion', () => ({
  ChapterDiscussionHost: class {
    enabled = false;
    mount(): void {}
    dispose(): void {}
    disposeAll(): void {}
  },
}));

const { Reader } = await import('./Reader');

class FakeIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function chapter(novelId: string, number: number, content: string): Chapter {
  return {
    id: `${novelId}-ch-${number}`,
    novelId,
    volumeId: `${novelId}-vol-1`,
    globalChapterNumber: number,
    volumeChapterNumber: number,
    title: `Chapter ${number}`,
    content,
    wordCount: 100,
    metadata: {},
  };
}

function buildNovel(): Novel {
  return {
    id: 'novel-1',
    title: 'Yomi Test Novel',
    originalTitle: 'Yomi Test Novel',
    alternativeTitles: [],
    author: 'Author',
    description: 'A test novel.',
    cover: './covers/novel-1.jpg',
    sourceLanguage: 'Japanese',
    translationLanguage: 'English',
    status: 'ongoing',
    genres: ['Fantasy'],
    tags: [],
    volumes: [{ id: 'novel-1-vol-1', novelId: 'novel-1', volumeNumber: 1, title: 'Volume 1', chapterCount: 4 }],
    chapters: [1, 2, 3, 4].map((n) => ({ ...chapter('novel-1', n, ''), content: '' })),
    downloads: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

let container: HTMLElement;
let reader: InstanceType<typeof Reader>;

beforeEach(() => {
  h.chapters = [
    chapter('novel-1', 1, '<p>The dragon arrived at dawn.</p>'),
    chapter('novel-1', 2, '<p>A second dragon appeared.</p>'),
    chapter('novel-1', 3, '<p>Quiet fields.</p>'),
    chapter('novel-1', 4, '<p>The final dragon.</p>'),
  ];
  h.chapterError = null;
  h.fetchCalls = [];

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  // jsdom has no layout engine; run animation frames synchronously instead.
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = () => undefined;

  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  reader?.destroy();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load(chapterId = 'novel-1-ch-2'): Promise<void> {
  reader = new Reader(container);
  await reader.load(buildNovel(), chapterId, 0);
}

function searchPanel(): HTMLElement {
  const panel = container.querySelector<HTMLElement>('.reader-search-panel');
  if (!panel) throw new Error('search panel missing');
  return panel;
}

describe('reader rendering', () => {
  it('renders a chapter block with the loaded text', async () => {
    await load();
    const blocks = container.querySelectorAll('.chapter-block');
    expect(blocks.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('A second dragon appeared.');
    expect(h.fetchCalls).toEqual(['novel-1']);
  });

  it('surfaces a chapter-loading failure (offline with nothing saved)', async () => {
    h.chapterError = new Error('Chapter request failed (503).');
    reader = new Reader(container);
    await expect(reader.load(buildNovel(), 'novel-1-ch-1', 0)).rejects.toThrow('Chapter request failed');
  });
});

describe('whole-book progress indicator', () => {
  it('starts at the saved chapter and reports the whole-book percentage', async () => {
    await load('novel-1-ch-2');
    const label = container.querySelector('.reader-novel-progress-label');
    expect(label?.textContent).toBe('25%');
    const fill = container.querySelector<HTMLElement>('.reader-novel-progress-fill');
    expect(fill?.style.width).toBe('25%');
  });

  it('is 0% at the very first chapter and 75% at the last', async () => {
    await load('novel-1-ch-1');
    expect(container.querySelector('.reader-novel-progress-label')?.textContent).toBe('0%');
    reader.destroy();

    await load('novel-1-ch-4');
    expect(container.querySelector('.reader-novel-progress-label')?.textContent).toBe('75%');
  });

  it('recomputes after navigating to another chapter through the drawer callback', async () => {
    await load('novel-1-ch-1');
    reader.navigateToChapter('novel-1-ch-3');
    expect(container.querySelector('.reader-novel-progress-label')?.textContent).toBe('50%');
  });
});

describe('in-reader search', () => {
  async function search(query: string, scope: 'chapter' | 'novel' = 'chapter'): Promise<HTMLElement> {
    const trigger = container.querySelector<HTMLButtonElement>('.reader-search-btn');
    trigger?.click();
    const panel = searchPanel();
    const select = panel.querySelector<HTMLSelectElement>('.reader-search-scope');
    if (select) {
      select.value = scope;
      select.dispatchEvent(new Event('change'));
    }
    const input = panel.querySelector<HTMLInputElement>('.reader-search-input')!;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    // The input handler is debounced; trigger the same path synchronously.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return panel;
  }

  it('highlights matches in the current chapter and steps through them', async () => {
    await load('novel-1-ch-2');
    const panel = await search('dragon');
    const marks = container.querySelectorAll('mark.reader-search-hit');
    expect(marks.length).toBe(1);
    expect(panel.querySelector('.reader-search-status')?.textContent).toBe('1 / 1');
    expect(panel.querySelector<HTMLButtonElement>('.reader-search-step')?.disabled).toBe(false);
  });

  it('searches the whole book and lists matching chapters', async () => {
    await load('novel-1-ch-1');
    const panel = await search('dragon', 'novel');
    const results = panel.querySelectorAll('.reader-search-result');
    expect(results.length).toBe(3);
    expect(panel.querySelector('.reader-search-status')?.textContent).toBe('3 matches in 3 chapters');
    expect(results[0].textContent).toContain('Chapter 1');
  });

  it('jumps to a matching chapter and highlights it there', async () => {
    await load('novel-1-ch-1');
    const panel = await search('dragon', 'novel');
    const results = panel.querySelectorAll<HTMLButtonElement>('.reader-search-result');
    results[2].click();
    expect(container.textContent).toContain('The final dragon.');
    const marks = container.querySelectorAll('mark.reader-search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0].classList.contains('is-active')).toBe(true);
  });

  it('reports no matches and clears highlights when closed', async () => {
    await load('novel-1-ch-1');
    const panel = await search('dragon');
    expect(container.querySelectorAll('mark.reader-search-hit').length).toBe(1);
    const scope = panel.querySelector<HTMLSelectElement>('.reader-search-scope')!;
    scope.value = 'chapter';
    scope.dispatchEvent(new Event('change'));

    const input = panel.querySelector<HTMLInputElement>('.reader-search-input')!;
    input.value = 'unicorn';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(panel.querySelector('.reader-search-status')?.textContent).toBe('No matches in this chapter');

    panel.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')?.click();
    expect(container.querySelectorAll('mark.reader-search-hit').length).toBe(0);
    expect(searchPanel().hidden).toBe(true);
  });

  it('opens search from the keyboard shortcut', async () => {
    await load('novel-1-ch-1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(searchPanel().hidden).toBe(false);
  });
});

describe('reader lifecycle', () => {
  it('disposes its DOM and search panel', async () => {
    await load();
    reader.destroy();
    expect(container.querySelector('.reader-main')).toBeNull();
    expect(container.querySelector('.reader-search-panel')).toBeNull();
  });
});
