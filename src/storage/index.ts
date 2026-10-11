/* ─── IndexedDB Storage Layer ─── */

import type { Chapter, Novel, ReadingProgress, UserSettings } from '../models';

const DB_NAME = 'yomi-reader';
const DB_VERSION = 5;

export function openStorageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('reading_progress')) {
        const store = db.createObjectStore('reading_progress', { keyPath: 'novelId' });
        store.createIndex('lastRead', 'lastRead', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('imported_novels')) {
        db.createObjectStore('imported_novels', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('imported_chapters')) {
        const chapters = db.createObjectStore('imported_chapters', { keyPath: 'id' });
        chapters.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!db.objectStoreNames.contains('offline_shared_novels')) {
        db.createObjectStore('offline_shared_novels', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('offline_shared_chapters')) {
        const chapters = db.createObjectStore('offline_shared_chapters', { keyPath: 'id' });
        chapters.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!db.objectStoreNames.contains('shelves')) {
        db.createObjectStore('shelves', { keyPath: 'novelId' });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

const openDB = openStorageDB;

/** Ask the browser to protect this site's data from automatic storage eviction. */
export async function requestPersistentStorage(): Promise<{ supported: boolean; granted: boolean }> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
      return { supported: false, granted: false };
    }

    return { supported: true, granted: await navigator.storage.persist() };
  } catch {
    // Browser policy may deny or fail the request; storage remains usable as best-effort.
    return { supported: true, granted: false };
  }
}

/** Read the browser's best-effort estimate of this origin's storage use and quota. */
export async function getStorageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
      return {};
    }

    const estimate = await navigator.storage.estimate();
    return {
      ...(typeof estimate.usage === 'number' ? { usage: estimate.usage } : {}),
      ...(typeof estimate.quota === 'number' ? { quota: estimate.quota } : {}),
    };
  } catch {
    // Quota estimates are advisory and should never prevent reading or importing books.
    return {};
  }
}

export async function saveImportedNovel(novel: Novel, chapters: Chapter[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['imported_novels', 'imported_chapters'], 'readwrite');
    tx.objectStore('imported_novels').add(novel);
    const chapterStore = tx.objectStore('imported_chapters');
    for (const chapter of chapters) chapterStore.add(chapter);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Import was not saved.')); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Import was not saved.')); };
  });
}

export async function getImportedNovels(): Promise<Novel[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('imported_novels', 'readonly');
    const request = tx.objectStore('imported_novels').getAll();
    request.onsuccess = () => { db.close(); resolve(request.result as Novel[]); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function getImportedNovel(novelId: string): Promise<Novel | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('imported_novels', 'readonly');
    const request = tx.objectStore('imported_novels').get(novelId);
    request.onsuccess = () => { db.close(); resolve(request.result as Novel | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function getImportedChapters(novelId: string): Promise<Chapter[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('imported_chapters', 'readonly');
    const request = tx.objectStore('imported_chapters').index('novelId').getAll(novelId);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as Chapter[]).sort((a, b) => a.globalChapterNumber - b.globalChapterNumber));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/* ─── Reading Progress ─── */

export async function saveReadingProgress(progress: ReadingProgress): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reading_progress', 'readwrite');
    tx.objectStore('reading_progress').put(progress);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getReadingProgress(novelId: string): Promise<ReadingProgress | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reading_progress', 'readonly');
    const req = tx.objectStore('reading_progress').get(novelId);
    req.onsuccess = () => { db.close(); resolve(req.result ?? undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function getAllReadingProgress(): Promise<ReadingProgress[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reading_progress', 'readonly');
    const req = tx.objectStore('reading_progress').getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteReadingProgress(novelId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reading_progress', 'readwrite');
    tx.objectStore('reading_progress').delete(novelId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/* ─── Settings ─── */

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => { db.close(); resolve(req.result?.value as T | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/* ─── Convenience: read/write UserSettings ─── */

const SETTINGS_KEY = 'user_settings';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'midnight',
  fontSize: 18,
  lineHeight: 1.8,
  readingWidth: 720,
  pageMargin: 24,
  fontFamily: 'serif',
  textAlign: 'left',
  paragraphSpacing: 1.2,
  letterSpacing: 0,
  infiniteScroll: true,
  readerLoadingStrategy: 'balanced',
};

export async function loadUserSettings(): Promise<UserSettings> {
  const saved = await getSetting<UserSettings>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveUserSettings(s: UserSettings): Promise<void> {
  await saveSetting(SETTINGS_KEY, s);
}

export { DEFAULT_SETTINGS };
