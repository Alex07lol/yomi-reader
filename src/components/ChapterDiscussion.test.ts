import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../models';

const h = vi.hoisted(() => ({
  instances: [] as Array<{ scope: { novelId: string; chapterId: string | null }; disposed: boolean; opened: boolean }>,
  count: 0,
  calls: 0,
}));

vi.mock('../community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../community')>();
  return {
    ...actual,
    isCommunityConfigured: () => true,
    getCommunityAvailability: () => 'ready',
    getCommentCount: async () => {
      h.calls += 1;
      return h.count;
    },
  };
});

vi.mock('./DiscussionPanel', () => ({
  DiscussionPanel: class StubPanel {
    element = document.createElement('section');
    count = 0;
    opened = false;
    disposed = false;
    scope: { novelId: string; chapterId: string | null };
    constructor(options: { scope: { novelId: string; chapterId: string | null }; startOpen?: boolean }) {
      this.scope = options.scope;
      if (options.startOpen) this.opened = true;
      h.instances.push(this);
    }
    open(): void { this.opened = true; }
    close(): void { this.opened = false; }
    dispose(): void { this.disposed = true; this.element.remove(); }
    loadCount(): Promise<number> { return Promise.resolve(this.count); }
  },
}));

const { ChapterDiscussionHost } = await import('./ChapterDiscussion');

function chapter(id: string, novelId = 'novel-1'): Chapter {
  return {
    id,
    novelId,
    volumeId: 'vol-1',
    globalChapterNumber: 1,
    volumeChapterNumber: 1,
    title: 'Chapter One',
    content: '<p>text</p>',
    wordCount: 10,
    metadata: {},
  };
}

beforeEach(() => {
  h.instances.length = 0;
  h.count = 0;
  h.calls = 0;
});

describe('ChapterDiscussionHost', () => {
  it('mounts exactly one region per chapter, keyed by stable id', () => {
    const host = new ChapterDiscussionHost();
    const block = document.createElement('article');
    host.mount(chapter('ch-1'), block);
    host.mount(chapter('ch-1'), block);
    expect(block.querySelectorAll('.chapter-discussion')).toHaveLength(1);
    expect(block.querySelector('[data-chapter-id="ch-1"]')).not.toBeNull();
  });

  it('keeps chapter scopes isolated and derived from ids', () => {
    const host = new ChapterDiscussionHost();
    const blockA = document.createElement('article');
    const blockB = document.createElement('article');
    host.mount(chapter('ch-a1', 'novel-a'), blockA);
    host.mount(chapter('ch-b1', 'novel-b'), blockB);
    blockA.querySelector<HTMLButtonElement>('.chapter-discussion-toggle')?.click();
    blockB.querySelector<HTMLButtonElement>('.chapter-discussion-toggle')?.click();
    const scopes = h.instances.map((instance) => instance.scope);
    expect(scopes).toContainEqual({ novelId: 'novel-a', chapterId: 'ch-a1' });
    expect(scopes).toContainEqual({ novelId: 'novel-b', chapterId: 'ch-b1' });
    expect(scopes).toHaveLength(2);
  });

  it('opens the panel lazily and reports aria-expanded', () => {
    const host = new ChapterDiscussionHost();
    const block = document.createElement('article');
    host.mount(chapter('ch-9'), block);
    expect(h.instances).toHaveLength(0);

    const toggle = block.querySelector<HTMLButtonElement>('.chapter-discussion-toggle')!;
    toggle.click();
    expect(h.instances).toHaveLength(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(h.instances[0].opened).toBe(true);
  });

  it('disposes a chapter discussion together with its chapter', () => {
    const host = new ChapterDiscussionHost();
    const block = document.createElement('article');
    document.body.appendChild(block);
    host.mount(chapter('ch-2'), block);
    block.querySelector<HTMLButtonElement>('.chapter-discussion-toggle')?.click();

    host.dispose('ch-2');
    expect(host.has('ch-2')).toBe(false);
    expect(block.querySelector('.chapter-discussion')).toBeNull();
    expect(h.instances[0].disposed).toBe(true);
    block.remove();
  });

  it('can re-mount a chapter after the whole window is disposed', () => {
    const host = new ChapterDiscussionHost();
    const block = document.createElement('article');
    host.mount(chapter('ch-1'), block);
    host.disposeAll();
    host.mount(chapter('ch-1'), block);
    expect(host.has('ch-1')).toBe(true);
    expect(block.querySelectorAll('.chapter-discussion')).toHaveLength(1);
  });

  it('disposes every remaining discussion on teardown', () => {
    const host = new ChapterDiscussionHost();
    const block = document.createElement('article');
    host.mount(chapter('ch-1'), block);
    host.mount(chapter('ch-2'), block);
    host.disposeAll();
    expect(host.has('ch-1')).toBe(false);
    expect(host.has('ch-2')).toBe(false);
    expect(block.querySelectorAll('.chapter-discussion')).toHaveLength(0);
  });
});
