import { describe, expect, it } from 'vitest';
import type { Chapter } from '../models';
import {
  formatDuration,
  formatReadingRemaining,
  novelProgressFraction,
  novelProgressPercent,
  remainingReading,
} from './progress-stats';

function chapter(id: string, number: number, wordCount: number): Chapter {
  return {
    id,
    novelId: 'novel-1',
    volumeId: 'v1',
    globalChapterNumber: number,
    volumeChapterNumber: number,
    title: `Chapter ${number}`,
    content: '<p>x</p>',
    wordCount,
    metadata: {},
  };
}

const chapters = [chapter('c1', 1, 1000), chapter('c2', 2, 1000), chapter('c3', 3, 1000), chapter('c4', 4, 1000)];

describe('novel progress', () => {
  it('is zero without a saved position', () => {
    expect(novelProgressPercent(chapters, null)).toBe(0);
    expect(novelProgressFraction(chapters, { chapterId: 'missing', progress: 0.5 })).toBe(0);
  });

  it('combines chapter position with the in-chapter fraction', () => {
    expect(novelProgressPercent(chapters, { chapterId: 'c1', progress: 0 })).toBe(0);
    expect(novelProgressPercent(chapters, { chapterId: 'c1', progress: 0.5 })).toBe(13);
    expect(novelProgressPercent(chapters, { chapterId: 'c3', progress: 0 })).toBe(50);
    expect(novelProgressPercent(chapters, { chapterId: 'c4', progress: 0.99 })).toBe(100);
  });

  it('clamps out-of-range fractions', () => {
    expect(novelProgressFraction(chapters, { chapterId: 'c1', progress: 5 })).toBeCloseTo(0.25);
    expect(novelProgressFraction(chapters, { chapterId: 'c1', progress: -3 })).toBe(0);
  });
});

describe('remaining reading', () => {
  it('counts the rest of the current chapter plus later chapters', () => {
    const remaining = remainingReading(chapters, { chapterId: 'c2', progress: 0.5 });
    expect(remaining.wordsLeft).toBe(500 + 1000 + 1000);
    expect(remaining.chaptersLeft).toBe(3);
    expect(remaining.minutesLeft).toBe(Math.round(2500 / 220));
  });

  it('reports the whole book when there is no position', () => {
    const remaining = remainingReading(chapters, null);
    expect(remaining.wordsLeft).toBe(4000);
    expect(remaining.chaptersLeft).toBe(4);
  });

  it('respects a custom reading speed', () => {
    expect(remainingReading(chapters, { chapterId: 'c4', progress: 0 }, 100).minutesLeft).toBe(10);
  });
});

describe('duration formatting', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('under a minute');
    expect(formatDuration(12)).toBe('12 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(200)).toBe('3 h 20 min');
  });

  it('describes a finished book', () => {
    expect(formatReadingRemaining({ chaptersLeft: 0, wordsLeft: 0, minutesLeft: 0 })).toBe('Finished');
    expect(formatReadingRemaining({ chaptersLeft: 3, wordsLeft: 2500, minutesLeft: 11 })).toBe('about 11 min left');
  });
});
