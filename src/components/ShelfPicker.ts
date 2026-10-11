/* ─── Shelf picker ───
   Places a novel on Want to read / Reading / Finished. Writes to IndexedDB
   immediately and, when the reader is signed in, mirrors the change to their
   account. A failed mirror never blocks or reverts the local change. */

import { el, empty } from '../utils/dom';
import { SHELF_IDS, SHELF_LABELS } from '../utils/shelves';
import { getShelf, removeShelfLocal, setShelfLocal } from '../storage/shelves';
import { pushShelfChange } from '../community';
import type { ReadingShelf, ShelfId } from '../models';

export interface ShelfPickerOptions {
  novelId: string;
  compact?: boolean;
  onChange?: (shelf: ReadingShelf | undefined) => void;
}

export class ShelfPicker {
  readonly element: HTMLElement;
  private readonly novelId: string;
  private readonly onChange?: (shelf: ReadingShelf | undefined) => void;
  private readonly buttonsHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private current: ReadingShelf | undefined;
  private busy = false;

  constructor(options: ShelfPickerOptions) {
    this.novelId = options.novelId;
    this.onChange = options.onChange;

    this.buttonsHost = el('div', {
      className: 'shelf-picker-buttons',
      role: 'group',
      'aria-label': 'Reading shelf',
    });
    this.statusEl = el('span', { className: 'shelf-picker-status', role: 'status', 'aria-live': 'polite' });

    this.element = el('div', {
      className: `shelf-picker${options.compact ? ' shelf-picker-compact' : ''}`,
    },
      el('span', { className: 'shelf-picker-label', text: 'Shelf' }),
      this.buttonsHost,
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
    empty(this.buttonsHost);
    const active = this.current && !this.current.deleted ? this.current.shelf : null;

    for (const shelf of SHELF_IDS) {
      const isActive = active === shelf;
      this.buttonsHost.appendChild(el('button', {
        className: `shelf-picker-button${isActive ? ' is-active' : ''}`,
        type: 'button',
        disabled: this.busy,
        'aria-pressed': String(isActive),
        text: SHELF_LABELS[shelf],
        onclick: () => void this.choose(shelf),
      }));
    }

    if (active) {
      this.buttonsHost.appendChild(el('button', {
        className: 'shelf-picker-clear',
        type: 'button',
        disabled: this.busy,
        text: 'Remove',
        'aria-label': 'Remove from shelves',
        onclick: () => void this.clear(),
      }));
    }
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
