/* ─── Explicitly saved shared books ─── */

import type { Chapter, Novel } from '../models';
import { openStorageDB } from './index';

type StoreName = 'offline_shared_novels' | 'offline_shared_chapters';

function withTransaction<T>(
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  queue: (tx: IDBTransaction, setResult: (value: T) => void) => void,
): Promise<T> {
  return openStorageDB().then(db => new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    let result: T | undefined;
    let transactionError: DOMException | null = null;

    try {
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? transactionError ?? new Error('Offline book storage transaction was aborted.'));
    };
    // IndexedDB dispatches abort after an unhandled request/transaction error.
    // Keep the connection open until that event so all queued transaction events
    // can finish and the close does not interfere with an active transaction.
    tx.onerror = () => { transactionError ??= tx.error; };

    try {
      queue(tx, value => { result = value; });
    } catch (error) {
      transactionError ??= error instanceof DOMException ? error : null;
      try {
        tx.abort();
      } catch {
        db.close();
        reject(error);
      }
    }
  }));
}

function deleteChaptersForNovel(tx: IDBTransaction, novelId: string, afterDelete: () => void): void {
  const chapters = tx.objectStore('offline_shared_chapters');
  const request = chapters.index('novelId').openCursor(IDBKeyRange.only(novelId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
      return;
    }
    afterDelete();
  };
}

export async function saveSharedNovelOffline(novel: Novel, chapters: Chapter[]): Promise<void> {
  if (chapters.some(chapter => chapter.novelId !== novel.id)) {
    throw new Error('Every saved chapter must belong to the saved novel.');
  }
  if (new Set(chapters.map(chapter => chapter.id)).size !== chapters.length) {
    throw new Error('A saved book cannot contain duplicate chapter IDs.');
  }

  return withTransaction(['offline_shared_novels', 'offline_shared_chapters'], 'readwrite', (tx, setResult) => {
    const novelStore = tx.objectStore('offline_shared_novels');
    const chapterStore = tx.objectStore('offline_shared_chapters');
    deleteChaptersForNovel(tx, novel.id, () => {
      novelStore.put(novel);
      for (const chapter of chapters) chapterStore.add(chapter);
    });
    setResult(undefined);
  });
}

export async function getSavedSharedNovel(novelId: string): Promise<Novel | undefined> {
  return withTransaction(['offline_shared_novels'], 'readonly', (tx, setResult) => {
    const request = tx.objectStore('offline_shared_novels').get(novelId);
    request.onsuccess = () => setResult(request.result as Novel | undefined);
  });
}

/**
 * Read every explicitly saved shared snapshot in one IndexedDB request.
 * Callers can derive IDs from these records without opening a database once
 * per library card, and the same records can be used as a catalog fallback.
 */
export async function getSavedSharedNovels(): Promise<Novel[]> {
  return withTransaction(['offline_shared_novels'], 'readonly', (tx, setResult) => {
    const request = tx.objectStore('offline_shared_novels').getAll();
    request.onsuccess = () => setResult(request.result as Novel[]);
  });
}

/** Read saved IDs with one object-store request when records are not needed. */
export async function getSavedSharedNovelIds(): Promise<Set<string>> {
  return withTransaction(['offline_shared_novels'], 'readonly', (tx, setResult) => {
    const request = tx.objectStore('offline_shared_novels').getAllKeys();
    request.onsuccess = () => setResult(new Set(request.result.filter((id): id is string => typeof id === 'string')));
  });
}

export async function getSavedSharedChapters(novelId: string): Promise<Chapter[]> {
  return withTransaction(['offline_shared_chapters'], 'readonly', (tx, setResult) => {
    const request = tx.objectStore('offline_shared_chapters').index('novelId').getAll(novelId);
    request.onsuccess = () => {
      const chapters = request.result as Chapter[];
      setResult(chapters.sort((a, b) => a.globalChapterNumber - b.globalChapterNumber));
    };
  });
}

export async function removeSharedNovelOffline(novelId: string): Promise<void> {
  return withTransaction(['offline_shared_novels', 'offline_shared_chapters'], 'readwrite', (tx, setResult) => {
    tx.objectStore('offline_shared_novels').delete(novelId);
    deleteChaptersForNovel(tx, novelId, () => setResult(undefined));
  });
}

export async function isSharedNovelSaved(novelId: string): Promise<boolean> {
  return withTransaction(['offline_shared_novels'], 'readonly', (tx, setResult) => {
    const request = tx.objectStore('offline_shared_novels').count(novelId);
    request.onsuccess = () => setResult(request.result > 0);
  });
}
