/* ─── Local reading shelves ───
   Shelves live in IndexedDB and work with no account. Removals are kept as
   tombstones so a sign-in merge cannot resurrect a shelf that was cleared
   locally. `src/community/shelves.ts` merges these rows with the account copy. */

import type { ReadingShelf, ShelfId } from '../models';
import { openStorageDB } from './index';
import { isShelfId } from '../utils/shelves';

export { SHELF_IDS, SHELF_LABELS, isShelfId } from '../utils/shelves';

function withShelfStore<T>(mode: IDBTransactionMode, queue: (store: IDBObjectStore) => IDBRequest, read: (request: IDBRequest) => T): Promise<T> {
  return openStorageDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction('shelves', mode);
    let result: T;
    let failed: unknown = null;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(failed ?? tx.error ?? new Error('Shelf storage was aborted.')); };
    tx.onerror = () => { failed ??= tx.error; };
    try {
      const request = queue(tx.objectStore('shelves'));
      request.onsuccess = () => { result = read(request); };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

/** Every stored row, including tombstones. Used by the account merge. */
export async function getAllShelveRows(): Promise<ReadingShelf[]> {
  const rows = await withShelfStore<ReadingShelf[]>('readonly', store => store.getAll(), request => request.result as ReadingShelf[]);
  return rows.filter(row => isShelfId(row.shelf) && typeof row.novelId === 'string');
}

/** The shelves a reader should see: tombstones excluded. */
export async function getActiveShelves(): Promise<ReadingShelf[]> {
  return (await getAllShelveRows()).filter(row => !row.deleted);
}

export async function getShelf(novelId: string): Promise<ReadingShelf | undefined> {
  const row = await withShelfStore<ReadingShelf | undefined>(
    'readonly',
    store => store.get(novelId),
    request => request.result as ReadingShelf | undefined,
  );
  return row && isShelfId(row.shelf) ? row : undefined;
}

export async function setShelfLocal(novelId: string, shelf: ShelfId, updatedAt = Date.now()): Promise<ReadingShelf> {
  const row: ReadingShelf = { novelId, shelf, updatedAt, deleted: false };
  await withShelfStore('readwrite', store => store.put(row), () => undefined);
  return row;
}

/** Removes a novel from all shelves locally, keeping a tombstone for sync. */
export async function removeShelfLocal(novelId: string, previous?: ReadingShelf, updatedAt = Date.now()): Promise<ReadingShelf> {
  const row: ReadingShelf = {
    novelId,
    shelf: previous?.shelf ?? 'want',
    updatedAt,
    deleted: true,
  };
  await withShelfStore('readwrite', store => store.put(row), () => undefined);
  return row;
}

/** Replaces the whole local shelf set after an account merge. */
export async function replaceAllShelves(shelves: ReadingShelf[]): Promise<void> {
  await openStorageDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shelves', 'readwrite');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Shelf storage was aborted.')); };
    tx.onerror = () => { /* surfaced through onabort */ };
    const store = tx.objectStore('shelves');
    store.clear();
    for (const shelf of shelves) store.put(shelf);
  }));
}
