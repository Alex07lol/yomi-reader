/* ─── Reading progress statistics ───
   Pure helpers that turn a chapter list plus one saved position into the values
   the UI shows: how far through a book a reader is and how long the rest is
   likely to take. Kept dependency-free so both the library and the reader share
   exactly the same numbers. */

import type { Chapter, ReadingProgress } from '../models';

/** Average adult silent-reading speed, used only for a rough estimate. */
export const DEFAULT_READING_WPM = 220;

/** The minimum a progress record needs for these calculations. */
export type ProgressPosition = Pick<ReadingProgress, 'chapterId' | 'progress'>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function chapterIndex(chapters: Chapter[], progress: ProgressPosition | null): number {
  if (!progress) return -1;
  return chapters.findIndex(chapter => chapter.id === progress.chapterId);
}

/**
 * Fraction of the whole novel that is read (0–1). It combines how many chapters
 * precede the current one with how far into the current chapter the reader is,
 * so a reader 60 chapters into a 100-chapter book sees ~60%.
 */
export function novelProgressFraction(chapters: Chapter[], progress: ProgressPosition | null): number {
  if (chapters.length === 0) return 0;
  const index = chapterIndex(chapters, progress);
  if (index < 0) return 0;
  return clamp01((index + clamp01(progress!.progress)) / chapters.length);
}

/** Novel progress as a whole percentage (0–100), rounded. */
export function novelProgressPercent(chapters: Chapter[], progress: ProgressPosition | null): number {
  return Math.round(novelProgressFraction(chapters, progress) * 100);
}

export interface RemainingReading {
  chaptersLeft: number;
  wordsLeft: number;
  minutesLeft: number;
}

/** Words left in the current chapter plus every chapter after it. */
export function remainingReading(
  chapters: Chapter[],
  progress: ProgressPosition | null,
  wordsPerMinute: number = DEFAULT_READING_WPM,
): RemainingReading {
  if (chapters.length === 0) return { chaptersLeft: 0, wordsLeft: 0, minutesLeft: 0 };

  const index = chapterIndex(chapters, progress);
  if (index < 0) {
    const wordsLeft = chapters.reduce((sum, chapter) => sum + Math.max(0, chapter.wordCount), 0);
    return { chaptersLeft: chapters.length, wordsLeft, minutesLeft: estimateMinutes(wordsLeft, wordsPerMinute) };
  }

  const current = chapters[index];
  const fractionRead = clamp01(progress!.progress);
  let wordsLeft = Math.round((1 - fractionRead) * Math.max(0, current.wordCount));
  for (let i = index + 1; i < chapters.length; i++) wordsLeft += Math.max(0, chapters[i].wordCount);

  const chaptersLeft = wordsLeft > 0 ? chapters.length - index : 0;
  return { chaptersLeft, wordsLeft, minutesLeft: estimateMinutes(wordsLeft, wordsPerMinute) };
}

function estimateMinutes(words: number, wordsPerMinute: number): number {
  const rate = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : DEFAULT_READING_WPM;
  return Math.round(words / rate);
}

/** "under a minute" / "12 min" / "3 h 20 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** A short human sentence for the remaining reading time. */
export function formatReadingRemaining(remaining: RemainingReading): string {
  if (remaining.wordsLeft <= 0) return 'Finished';
  const time = formatDuration(remaining.minutesLeft);
  return remaining.chaptersLeft <= 1 && remaining.wordsLeft < DEFAULT_READING_WPM
    ? `Finishing in ${time}`
    : `about ${time} left`;
}
