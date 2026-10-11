import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  shelves: [] as { novelId: string; shelf: string; updatedAt: number; deleted?: boolean }[],
  baselines: {} as Record<string, number>,
  seenCalls: [] as { novelId: string; chapterCount: number }[][],
  novels: [] as { id: string; title: string; chapters: unknown[] }[],
}));

vi.mock('../storage/shelves', () => ({
  getActiveShelves: async () => h.shelves,
}));

vi.mock('../storage/updates', () => ({
  getShelfUpdateBaselines: async () => ({ ...h.baselines }),
  markShelfUpdatesSeen: async (entries: { novelId: string; chapterCount: number }[]) => {
    h.seenCalls.push(entries);
    for (const entry of entries) h.baselines[entry.novelId] = entry.chapterCount;
  },
  setShelfUpdateBaseline: async (novelId: string, chapters: number) => { h.baselines[novelId] = chapters; },
}));

vi.mock('../data', () => ({
  fetchAllNovels: async () => h.novels,
}));

vi.mock('../community', () => ({
  onCommunityEvent: () => () => undefined,
}));

const { renderShelfUpdates } = await import('./ShelfUpdates');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const button = () => document.querySelector<HTMLButtonElement>('.shelf-updates-button');
const badge = () => document.querySelector<HTMLElement>('.shelf-updates-badge');
const panel = () => document.querySelector<HTMLElement>('.shelf-updates-panel');

function novel(id: string, title: string, chapters: number) {
  return { id, title, chapters: Array.from({ length: chapters }, (_v, i) => ({ id: `${id}-${i}` })) };
}

async function mount(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderShelfUpdates(container);
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  h.shelves = [];
  h.baselines = {};
  h.seenCalls = [];
  h.novels = [];
});

describe('shelf updates icon', () => {
  it('stays out of the navbar when nothing is shelved', async () => {
    h.novels = [novel('a', 'Alpha', 10)];
    await mount();
    expect(button()).toBeNull();
  });

  it('appears once a novel is shelved, establishing a baseline instead of reporting the whole book', async () => {
    h.shelves = [{ novelId: 'a', shelf: 'reading', updatedAt: 1 }];
    h.novels = [novel('a', 'Alpha', 10)];
    await mount();

    expect(button()).not.toBeNull();
    expect(button()!.getAttribute('aria-label')).toBe('Book updates');
    expect(badge()!.classList.contains('is-hidden')).toBe(true);
    expect(h.seenCalls).toEqual([[{ novelId: 'a', chapterCount: 10 }]]);
  });

  it('counts and lists the novels with new chapters', async () => {
    h.shelves = [{ novelId: 'a', shelf: 'reading', updatedAt: 1 }, { novelId: 'b', shelf: 'want', updatedAt: 1 }];
    h.novels = [novel('a', 'Alpha', 14), novel('b', 'Beta', 6)];
    h.baselines = { a: 10, b: 6 };
    await mount();

    expect(badge()!.textContent).toBe('1');
    expect(badge()!.classList.contains('is-hidden')).toBe(false);

    button()!.click();
    await flush();

    expect(panel()!.textContent).toContain('Alpha');
    expect(panel()!.textContent).toContain('+4 chapters');
    expect(panel()!.textContent).not.toContain('Beta');
  });

  it('marks the list seen when it is opened, so the badge clears', async () => {
    h.shelves = [{ novelId: 'a', shelf: 'reading', updatedAt: 1 }];
    h.novels = [novel('a', 'Alpha', 12)];
    h.baselines = { a: 10 };
    await mount();

    expect(badge()!.classList.contains('is-hidden')).toBe(false);
    button()!.click();
    await flush();

    expect(h.seenCalls).toContainEqual([{ novelId: 'a', chapterCount: 12 }]);
    expect(badge()!.classList.contains('is-hidden')).toBe(true);
    expect(button()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('sends the reader to the novel and closes behind them', async () => {
    h.shelves = [{ novelId: 'alpha one', shelf: 'reading', updatedAt: 1 }];
    h.novels = [{ id: 'alpha one', title: 'Alpha', chapters: new Array(3).fill({}) }];
    h.baselines = { 'alpha one': 1 };
    await mount();

    button()!.click();
    await flush();
    panel()!.querySelector<HTMLButtonElement>('.shelf-updates-item')!.click();
    await flush();

    expect(window.location.hash).toBe('#novel/alpha%20one');
    expect(panel()).toBeNull();
  });

  it('caps the badge and closes on Escape', async () => {
    h.shelves = Array.from({ length: 11 }, (_v, i) => ({ novelId: `n${i}`, shelf: 'reading', updatedAt: 1 }));
    h.novels = Array.from({ length: 11 }, (_v, i) => novel(`n${i}`, `Book ${i}`, 4));
    h.baselines = Object.fromEntries(Array.from({ length: 11 }, (_v, i) => [`n${i}`, 3]));
    await mount();

    expect(badge()!.textContent).toBe('9+');

    button()!.click();
    await flush();
    expect(document.querySelectorAll('.shelf-updates-item')).toHaveLength(11);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel()).toBeNull();
  });
});
