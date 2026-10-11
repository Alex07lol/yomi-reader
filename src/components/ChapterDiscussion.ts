/* ─── Chapter discussions for the infinite-scroll reader ───
   One collapsed discussion region per mounted chapter, keyed by the stable
   chapter ID. Panels are created only when a reader opens them and are
   disposed together with their chapter element, so loading and unloading
   chapters never duplicates threads or leaks observers. */

import { el } from '../utils/dom';
import type { Chapter } from '../models';
import { getCommentCount, getCommunityAvailability, isCommunityConfigured } from '../community';
import type { DiscussionScope } from '../community';
import { DiscussionPanel } from './DiscussionPanel';

interface MountedDiscussion {
  scope: DiscussionScope;
  panel: DiscussionPanel | null;
  region: HTMLElement;
  body: HTMLElement;
  toggle: HTMLButtonElement;
  countLabel: HTMLElement;
  observer: IntersectionObserver | null;
  countRequested: boolean;
  open: boolean;
}

export class ChapterDiscussionHost {
  private mounted = new Map<string, MountedDiscussion>();

  get enabled(): boolean {
    return isCommunityConfigured() && getCommunityAvailability() !== 'unconfigured';
  }

  has(chapterId: string): boolean {
    return this.mounted.has(chapterId);
  }

  /** Appends the collapsed discussion region for a chapter. */
  mount(chapter: Chapter, parent: HTMLElement): void {
    if (!this.enabled) return;
    if (this.mounted.has(chapter.id)) return;

    const countLabel = el('span', { className: 'chapter-discussion-count', 'aria-hidden': 'true' });
    const toggle = el('button', {
      className: 'chapter-discussion-toggle',
      type: 'button',
      'aria-expanded': 'false',
    },
      el('span', { className: 'chapter-discussion-icon', 'aria-hidden': 'true', text: '💬' }),
      el('span', { text: 'Comments' }),
      countLabel,
    ) as HTMLButtonElement;

    const panelMount = el('div', { className: 'chapter-discussion-panel' });
    const back = el('button', {
      className: 'community-button community-button-ghost chapter-discussion-back',
      type: 'button',
      text: '← Back to chapter',
      onclick: () => {
        const block = parent.closest('.chapter-block');
        if (block) block.scrollIntoView({ block: 'start', behavior: 'auto' });
      },
    });
    const body = el('div', { className: 'chapter-discussion-body', hidden: true },
      el('div', { className: 'chapter-discussion-body-header' },
        el('span', { className: 'chapter-discussion-heading', text: 'Chapter discussion' }),
        back,
      ),
      panelMount,
    );

    const region = el('div', {
      className: 'chapter-discussion',
      'data-chapter-id': chapter.id,
    }, toggle, body);

    const record: MountedDiscussion = {
      // Scope always comes from stable IDs, never from the title or index.
      scope: { novelId: chapter.novelId, chapterId: chapter.id },
      panel: null,
      region,
      body,
      toggle,
      countLabel,
      observer: null,
      countRequested: false,
      open: false,
    };

    toggle.addEventListener('click', () => {
      this.setOpen(record, !record.open);
    });
    parent.appendChild(region);
    this.mounted.set(chapter.id, record);

    // Counts are decorative: fetch only when the region approaches the viewport.
    if (typeof IntersectionObserver !== 'undefined') {
      record.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            record.observer?.disconnect();
            record.observer = null;
            void this.loadCount(record);
            break;
          }
        }
      }, { rootMargin: '300px 0px' });
      record.observer.observe(region);
    }
  }

  open(chapterId: string): void {
    const record = this.mounted.get(chapterId);
    if (!record) return;
    this.setOpen(record, true);
    record.region.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  dispose(chapterId: string): void {
    const record = this.mounted.get(chapterId);
    if (!record) return;
    record.observer?.disconnect();
    record.observer = null;
    record.panel?.dispose();
    record.region.remove();
    this.mounted.delete(chapterId);
  }

  disposeAll(): void {
    for (const chapterId of [...this.mounted.keys()]) this.dispose(chapterId);
  }

  private setOpen(record: MountedDiscussion, open: boolean): void {
    record.open = open;
    record.body.hidden = !open;
    record.toggle.setAttribute('aria-expanded', String(open));

    if (open) {
      record.observer?.disconnect();
      record.observer = null;
      if (!record.panel) {
        record.panel = new DiscussionPanel({
          scope: record.scope,
          title: 'Chapter discussion',
          compact: true,
          startOpen: true,
        });
        record.panel.element.classList.add('community-panel-in-reader');
        record.region.querySelector('.chapter-discussion-panel')?.appendChild(record.panel.element);
        void record.panel.loadCount().then((count) => this.setCount(record, count));
      } else {
        record.panel.open();
      }
      record.countLabel.textContent = record.panel.count > 0 ? ` (${record.panel.count})` : '';
    } else {
      record.panel?.close();
    }
  }

  private async loadCount(record: MountedDiscussion): Promise<void> {
    if (record.countRequested) return;
    record.countRequested = true;
    try {
      const count = await getCommentCount(record.scope);
      this.setCount(record, count);
    } catch {
      // Counts are optional; the toggle still works offline.
    }
  }

  private setCount(record: MountedDiscussion, count: number): void {
    record.countLabel.textContent = count > 0 ? ` (${count})` : '';
  }
}
