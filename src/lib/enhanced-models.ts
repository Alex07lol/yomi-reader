/* ─── Enhanced Data Models ───
   Extensions to the core models supporting EPUB import,
   versioning, and better chapter tracking.
*/

import type { Novel, Chapter, Volume } from '../models';

/* ── Novel version (for future migration support) ── */

export interface NovelVersion {
  version: number;
  changedAt: number;
  changes: string[];
}

/* ── Import result ── */

export interface ImportResult {
  novel: Novel;
  chapters: Chapter[];
  volumes: Volume[];
  warnings: string[];
}

/* ── Helper: create a Chapter from ParsedEpub ── */

import type { ParsedChapter } from '../epub-import';

export function chapterFromParsed(
  parsed: ParsedChapter,
  novelId: string,
  volumeId: string,
  globalNumber: number,
  volumeNumber: number,
): Chapter {
  return {
    id: parsed.id,
    novelId,
    volumeId,
    globalChapterNumber: globalNumber,
    volumeChapterNumber: volumeNumber,
    title: parsed.title,
    content: parsed.content,
    wordCount: parsed.wordCount,
    metadata: { source: 'epub-import' },
  };
}

/* ── Helper: derive volume ID from novel + volume number ── */

export function volumeId(novelId: string, volumeNumber: number): string {
  return `${novelId}-vol-${volumeNumber}`;
}

/* ── Validate novel metadata ── */

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function validateNovel(novel: Novel): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!novel.title?.trim()) warnings.push({ field: 'title', message: 'Title is missing', severity: 'error' });
  if (!novel.author?.trim()) warnings.push({ field: 'author', message: 'Author is missing', severity: 'warning' });
  if (!novel.sourceLanguage) warnings.push({ field: 'sourceLanguage', message: 'Source language not set', severity: 'warning' });
  if (!novel.translationLanguage) warnings.push({ field: 'translationLanguage', message: 'Translation language not set', severity: 'warning' });
  if (novel.chapters.length === 0) warnings.push({ field: 'chapters', message: 'No chapters found', severity: 'error' });
  if (novel.volumes.length === 0 && novel.chapters.length > 0) warnings.push({ field: 'volumes', message: 'No volumes defined — chapters will be untracked', severity: 'warning' });

  /* Check for duplicate chapter IDs */
  const ids = new Set<string>();
  for (const ch of novel.chapters) {
    if (ids.has(ch.id)) warnings.push({ field: 'chapters', message: `Duplicate chapter ID: ${ch.id}`, severity: 'error' });
    ids.add(ch.id);
  }

  return warnings;
}