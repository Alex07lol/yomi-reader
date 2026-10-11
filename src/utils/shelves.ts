/* ─── Shelf constants shared by UI and storage ─── */

import type { ShelfId } from '../models';

/* The stored id `finished` is kept for the shelf the reader sees as "Completed";
   renaming it would mean migrating both IndexedDB rows and the database
   constraint for a label change. */
export const SHELF_IDS: ShelfId[] = ['want', 'reading', 'finished', 'dropped'];

export const SHELF_LABELS: Record<ShelfId, string> = {
  want: 'Want to read',
  reading: 'Reading',
  finished: 'Completed',
  dropped: 'Dropped',
};

export function isShelfId(value: unknown): value is ShelfId {
  return typeof value === 'string' && (SHELF_IDS as string[]).includes(value);
}
