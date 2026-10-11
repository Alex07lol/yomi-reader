/* ─── Shelf constants shared by UI and storage ─── */

import type { ShelfId } from '../models';

export const SHELF_IDS: ShelfId[] = ['want', 'reading', 'finished'];

export const SHELF_LABELS: Record<ShelfId, string> = {
  want: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
};

export function isShelfId(value: unknown): value is ShelfId {
  return typeof value === 'string' && (SHELF_IDS as string[]).includes(value);
}
