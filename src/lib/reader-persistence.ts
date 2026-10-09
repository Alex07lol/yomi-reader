/* ─── Reader Persistence ───
   Centralises reading-history storage, progress tracking,
   and restore-point computation on top of IndexedDB.
*/

import {
  saveReadingProgress,
  getReadingProgress,
  getAllReadingProgress,
  loadUserSettings,
  saveUserSettings,
  DEFAULT_SETTINGS,
} from '../storage';
import type { ReadingProgress, UserSettings, ThemeId } from '../models';
import { debounce } from '../utils/dom';

const PROGRESS_DEBOUNCE_MS = 400;

/* ── Persist progress ── */

export async function persistProgress(progress: ReadingProgress): Promise<void> {
  await saveReadingProgress(progress);
}

export async function loadProgress(novelId: string): Promise<ReadingProgress | undefined> {
  return getReadingProgress(novelId);
}

export async function loadAllProgress(): Promise<ReadingProgress[]> {
  return getAllReadingProgress();
}

/* ── Continue-reading helpers ── */

export async function getContinueReadingList(): Promise<ReadingProgress[]> {
  const all = await getAllReadingProgress();
  return all
    .filter(p => !p.completed)
    .sort((a, b) => b.lastRead - a.lastRead);
}

export async function getCompletedList(): Promise<ReadingProgress[]> {
  const all = await getAllReadingProgress();
  return all.filter(p => p.completed).sort((a, b) => b.lastRead - a.lastRead);
}

/* ── Settings ── */

export async function loadSettings(): Promise<UserSettings> {
  try {
    return await loadUserSettings();
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function applySettings(): Promise<UserSettings> {
  const s = await loadSettings();
  await saveUserSettings(s);
  return s;
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const s = { ...DEFAULT_SETTINGS, ...(await loadSettings()), ...patch };
  await saveUserSettings(s);
  return s;
}

export async function setTheme(theme: ThemeId): Promise<void> {
  await updateSettings({ theme });
}

/* ── Debounced auto-save ── */

export function createDebouncedSave(
  novelId: string,
  chapterId: string,
  globalChapterNumber: number,
  volumeId: string,
): () => Promise<void> {
  let lastProgress: ReadingProgress | null = null;

  const save = async (): Promise<void> => {
    if (!lastProgress) return;
    await saveReadingProgress(lastProgress);
  };

  const debounced = debounce(save, PROGRESS_DEBOUNCE_MS) as () => Promise<void>;

  return async () => {
    if (!lastProgress) return;
    lastProgress = {
      novelId,
      chapterId,
      globalChapterNumber,
      volumeId,
      progress: lastProgress.progress,
      scrollPosition: lastProgress.scrollPosition,
      lastRead: Date.now(),
      completed: lastProgress.completed,
    };
    await debounced();
  };
}

/* ── Record progress ── */

export function makeProgressRecord(
  novelId: string,
  chapterId: string,
  globalChapterNumber: number,
  volumeId: string,
  progress: number,
  scrollPosition: number,
  completed: boolean,
): ReadingProgress {
  return {
    novelId,
    chapterId,
    globalChapterNumber,
    volumeId,
    progress,
    scrollPosition,
    lastRead: Date.now(),
    completed,
  };
}