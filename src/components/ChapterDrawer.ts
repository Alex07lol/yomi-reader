/* ─── Chapter Drawer Component ─── */

import { el, empty } from '../utils/dom';
import type { Novel, Chapter } from '../models';
import { renderVolumeList } from './VolumeList';

export class ChapterDrawer {
  private overlay: HTMLElement;
  private drawer: HTMLElement;
  private isOpen = false;

  constructor() {
    this.overlay = el('div', { className: 'drawer-overlay', onclick: () => this.close() });
    this.drawer = el('div', { className: 'chapter-drawer', role: 'dialog', 'aria-label': 'Chapter navigation' });
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.drawer);
  }

  open(novel: Novel, chapters: Chapter[], currentChapterId: string, onNavigate: (chapterId: string) => void): void {
    if (this.isOpen) return;
    this.isOpen = true;

    empty(this.drawer);

    const header = el('div', { className: 'drawer-header' },
      el('h3', { text: novel.title }),
      el('button', {
        className: 'drawer-close',
        'aria-label': 'Close chapter drawer',
        onclick: () => this.close(),
      }, '✕'),
    );
    this.drawer.appendChild(header);

    const content = el('div', { className: 'drawer-content' });
    renderVolumeList(content, novel.volumes, chapters, currentChapterId, (chapterId) => {
      onNavigate(chapterId);
      this.close();
    });
    this.drawer.appendChild(content);

    this.overlay.classList.add('visible');
    this.drawer.classList.add('open');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.drawer.classList.remove('open');
  }

  toggle(novel: Novel, chapters: Chapter[], currentChapterId: string, onNavigate: (chapterId: string) => void): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(novel, chapters, currentChapterId, onNavigate);
    }
  }
}