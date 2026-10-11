/* ─── Shelf update baselines ───
   Remembers how many chapters a shelved novel had the last time the reader saw
   it, so the navbar can report what has been published since. Purely local: this
   is about the reader's own device and needs no account. */

import { openStorageDB } from './index';

export interface ShelfUpdateRecord {
  novelId: string;
  seenChapters: number;
  updatedAt: number;
}

function withStore<T>(
  mode: IDBTransactionMode,
  queue: (store: IDBObjectStore) => IDBRequest | void,
  read: () => T,
): Promise<T> {
  return openStorageDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction('shelf_updates', mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Shelf update storage was aborted.')); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Shelf update storage failed.')); };
    try {
      queue(tx.objectStore('shelf_updates'));
      result = read();
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

/** How many chapters each shelved novel had when it was last seen. */
export async function getShelfUpdateBaselines(): Promise<Record<string, number>> {
  const rows = await withStore<ShelfUpdateRecord[]>('readonly',
    store => store.getAll(),
    () => [] as ShelfUpdateRecord[],
  ).catch(() => [] as ShelfUpdateRecord[]);
  return Object.fromEntries(rows.map(row => [row.novelId, row.seenChapters]));
}

/** Records the chapter count the reader last saw for one novel. */
export async function setShelfUpdateBaseline(novelId: string, seenChapters: number): Promise<void> {
  await withStore<void>('readwrite',
    store => store.put({ novelId, seenChapters, updatedAt: Date.now() } satisfies ShelfUpdateRecord),
    () => undefined,
  );
}

/** Records the baseline for several novels at once. */
export async function markShelfUpdatesSeen(entries: { novelId: string; chapterCount: number }[]): Promise<void> {
  if (entries.length === 0) return;
  await withStore<void>('readwrite',
    store => {
      for (const entry of entries) {
        store.put({ novelId: entry.novelId, seenChapters: entry.chapterCount, updatedAt: Date.now() } satisfies ShelfUpdateRecord);
      }
    },
    () => undefined,
  );
}
