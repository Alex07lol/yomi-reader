/* ─── Shelf picker ───
   Places a novel on one of the reading shelves with a single dropdown. Writes to
   IndexedDB immediately and, when the reader is signed in, mirrors the change to
   their account. A failed mirror never blocks or reverts the local change. */

import { el, empty } from '../utils/dom';
import { SHELF_IDS, SHELF_LABELS } from '../utils/shelves';
import { getShelf, removeShelfLocal, setShelfLocal } from '../storage/shelves';
import { setShelfUpdateBaseline } from '../storage/updates';
import { pushShelfChange } from '../community';
import { renderSelectMenu } from './SelectMenu';
import type { ReadingShelf, ShelfId } from '../models';

export interface ShelfPickerOptions {
  novelId: string;
  /** Chapters published so far; recorded as the "seen" baseline when shelved. */
  chapterCount?: number;
  compact?: boolean;
  onChange?: (shelf: ReadingShelf | undefined) => void;
}

/** The dropdown's "no shelf" choice, which clears the novel's placement. */
const NO_SHELF = '';

export class ShelfPicker {
  readonly element: HTMLElement;
  private readonly novelId: string;
  private readonly chapterCount: number;
  private readonly onChange?: (shelf: ReadingShelf | undefined) => void;
  private readonly selectHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private current: ReadingShelf | undefined;
  private busy = false;

  constructor(options: ShelfPickerOptions) {
    this.novelId = options.novelId;
    this.chapterCount = Math.max(0, options.chapterCount ?? 0);
    this.onChange = options.onChange;

    this.selectHost = el('span', { className: 'shelf-picker-select' });
    this.statusEl = el('span', { className: 'shelf-picker-status', role: 'status', 'aria-live': 'polite' });

    this.element = el('div', {
      className: `shelf-picker${options.compact ? ' shelf-picker-compact' : ''}`,
    },
      el('span', { className: 'shelf-picker-label', text: 'Shelf' }),
      this.selectHost,
      this.statusEl,
    );

    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.current = await getShelf(this.novelId);
    } catch {
      this.current = undefined;
    }
    this.render();
  }

  private render(): void {
    empty(this.selectHost);
    const active = this.current && !this.current.deleted ? this.current.shelf : null;

    this.selectHost.appendChild(renderSelectMenu(
      'Reading shelf',
      active ?? NO_SHELF,
      [
        { value: NO_SHELF, label: 'Not on a shelf' },
        ...SHELF_IDS.map(shelf => ({ value: shelf, label: SHELF_LABELS[shelf] })),
      ],
      value => {
        if (value === NO_SHELF) void this.clear();
        else void this.choose(value as ShelfId);
      },
      'shelf-select',
      '',
      this.busy,
    ));
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private async choose(shelf: ShelfId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      const row = await setShelfLocal(this.novelId, shelf);
      this.current = row;
      this.onChange?.(row);
      this.setStatus(`${SHELF_LABELS[shelf]}.`);
      // Shelving a book must not immediately look like it has new chapters.
      if (this.chapterCount > 0) {
        void setShelfUpdateBaseline(this.novelId, this.chapterCount).catch(() => undefined);
      }
      void pushShelfChange(row).catch(() => undefined);
    } catch {
      this.setStatus('Your shelf could not be saved.');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async clear(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      const row = await removeShelfLocal(this.novelId, this.current);
      this.current = row;
      this.onChange?.(undefined);
      this.setStatus('Removed from your shelves.');
      void pushShelfChange(row).catch(() => undefined);
    } catch {
      this.setStatus('Your shelf could not be updated.');
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
