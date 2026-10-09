import JSZip from 'jszip';
import type { Chapter, Novel, ReadingProgress, UserSettings } from '../models';
import { openStorageDB } from './index';

export interface LibraryBackupManifest {
  format: 'yomi-library-backup';
  version: 1;
  exportedAt: number;
  counts: {
    novels: number;
    chapters: number;
    progress: number;
  };
}

interface LibraryBackupSnapshot {
  novels: unknown[];
  chapters: unknown[];
  settings: unknown[];
  progress: unknown[];
}

export interface BackupPreview {
  novels: number;
  chapters: number;
  progress: number;
  conflicts: string[];
}

export interface RestoreSummary {
  addedNovels: number;
  addedChapters: number;
  skippedNovels: number;
  restoredProgress: number;
}

interface ValidatedBackup {
  novels: Novel[];
  chapters: Chapter[];
  settings: Array<{ key: 'user_settings'; value: UserSettings }>;
  progress: ReadingProgress[];
}

const BACKUP_FILES = ['manifest.json', 'novels.json', 'chapters.json', 'settings.json', 'progress.json'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const THEMES = ['midnight', 'dark', 'light', 'oled', 'sepia', 'system'];
const LOADING_STRATEGIES = ['balanced', 'lightweight', 'preload'];
// Keep archive processing bounded before any JSON entry is inflated into memory.
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES: Record<typeof BACKUP_FILES[number], number> = {
  'manifest.json': 64 * 1024,
  'novels.json': 64 * 1024 * 1024,
  'chapters.json': 192 * 1024 * 1024,
  'settings.json': 2 * 1024 * 1024,
  'progress.json': 32 * 1024 * 1024,
};
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

interface BackupEntryStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): BackupEntryStream;
  on(event: 'error', listener: (error: unknown) => void): BackupEntryStream;
  on(event: 'end', listener: () => void): BackupEntryStream;
  pause(): void;
  resume(): void;
}

interface StreamableBackupEntry {
  internalStream(type: 'uint8array'): BackupEntryStream;
}

/** Validate an archive completely without changing local data. */
export async function inspectLibraryBackup(file: File): Promise<BackupPreview> {
  const backup = await readAndValidateBackup(file);
  const existingIds = await readExistingNovelIds();
  return {
    novels: backup.novels.length,
    chapters: backup.chapters.length,
    progress: backup.progress.length,
    conflicts: backup.novels.filter(novel => existingIds.has(novel.id)).map(novel => novel.id),
  };
}

/** Restore validated personal data atomically, skipping any existing book IDs. */
export async function restoreLibraryBackup(
  file: File,
  conflictPolicy: 'skip-existing',
): Promise<RestoreSummary> {
  if (conflictPolicy !== 'skip-existing') throw new Error('Unsupported backup conflict policy.');
  const backup = await readAndValidateBackup(file);
  const summary = await restoreValidatedBackup(backup);
  // Clear in-memory catalog/chapter state only after the IndexedDB transaction commits.
  try {
    const data = await import('../data');
    data.clearNovelCache();
  } catch {
    // A cache reset failure must not report a committed restore as failed.
  }
  return summary;
}

async function readAndValidateBackup(file: File): Promise<ValidatedBackup> {
  if (!(file instanceof Blob) || file.size < 4 || file.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Choose a valid Yomi backup ZIP file.');
  }
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, 4);
  const isZipSignature = signature[0] === 0x50 && signature[1] === 0x4b &&
    ((signature[2] === 0x03 && signature[3] === 0x04) ||
     (signature[2] === 0x05 && signature[3] === 0x06) ||
     (signature[2] === 0x07 && signature[3] === 0x08));
  if (!isZipSignature) throw new Error('This file is not a ZIP backup.');

  try {
    validateZipCentralDirectory(bytes);
  } catch {
    throw new Error('The backup ZIP is malformed or uses an unsupported format.');
  }

  let zip: JSZip;
  try {
    // CRC validation here would inflate entries before their declared sizes can
    // be checked. Validate the bounded JSON payloads as they are read instead.
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('The backup ZIP is damaged or cannot be read.');
  }
  const names = Object.keys(zip.files).sort();
  if (names.length !== BACKUP_FILES.length || names.some((name, i) => name !== [...BACKUP_FILES].sort()[i]) ||
      names.some(name => zip.files[name].dir)) {
    throw new Error('The backup is missing required files or contains unsupported entries.');
  }

  // JSZip normalizes some unsafe paths when loading. Require the original name
  // to be present and identical, and known top-level JSON names, before reading.
  let totalUncompressedBytes = 0;
  for (const name of names) {
    const entry = zip.files[name] as unknown as {
      unsafeOriginalName?: unknown;
      dir?: boolean;
      _data?: { compressedSize?: number; uncompressedSize?: number };
    };
    if (entry.dir || typeof entry.unsafeOriginalName !== 'string' || entry.unsafeOriginalName !== name ||
        !BACKUP_FILES.includes(name) || !entry._data ||
        !Number.isSafeInteger(entry._data.compressedSize) || entry._data.compressedSize! < 0 ||
        entry._data.compressedSize! > file.size ||
        !Number.isSafeInteger(entry._data.uncompressedSize) || entry._data.uncompressedSize! < 0 ||
        entry._data.uncompressedSize! > MAX_ENTRY_BYTES[name as typeof BACKUP_FILES[number]]) {
      throw new Error('The backup contains unsupported entries or is too large to read.');
    }
    totalUncompressedBytes += entry._data.uncompressedSize!;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('The backup contains unsupported entries or is too large to read.');
    }
  }

  const json = async (name: string, remainingTotalBytes: number): Promise<{ value: unknown; byteLength: number }> => {
    try {
      const entry = zip.file(name);
      if (!entry) throw new Error('Missing entry');
      const streamed = await readEntryText(entry as unknown as StreamableBackupEntry,
        Math.min(MAX_ENTRY_BYTES[name as typeof BACKUP_FILES[number]], remainingTotalBytes));
      return { value: JSON.parse(streamed.text) as unknown, byteLength: streamed.byteLength };
    } catch {
      throw new Error(`The backup file ${name} is missing or malformed.`);
    }
  };
  const values: unknown[] = [];
  let actualTotalBytes = 0;
  for (const name of BACKUP_FILES) {
    const parsed = await json(name, MAX_TOTAL_UNCOMPRESSED_BYTES - actualTotalBytes);
    actualTotalBytes += parsed.byteLength;
    values.push(parsed.value);
  }
  const [manifest, novelsValue, chaptersValue, settingsValue, progressValue] = values;
  if (!isRecord(manifest) || manifest.format !== 'yomi-library-backup' || manifest.version !== 1 ||
      !isNonNegativeInteger(manifest.exportedAt) || !isRecord(manifest.counts) ||
      !isNonNegativeInteger(manifest.counts.novels) || !isNonNegativeInteger(manifest.counts.chapters) ||
      !isNonNegativeInteger(manifest.counts.progress)) {
    throw new Error('This backup has an unsupported or malformed manifest.');
  }
  if (!Array.isArray(novelsValue) || !novelsValue.every(isNovel) ||
      !Array.isArray(chaptersValue) || !chaptersValue.every(isChapter) ||
      !Array.isArray(settingsValue) || !settingsValue.every(isSettingsEntry) ||
      !Array.isArray(progressValue) || !progressValue.every(isProgress)) {
    throw new Error('The backup contains malformed library data.');
  }
  const novels = novelsValue as Novel[];
  const chapters = chaptersValue as Chapter[];
  const settings = settingsValue as ValidatedBackup['settings'];
  const progress = progressValue as ReadingProgress[];
  if (manifest.counts.novels !== novels.length || manifest.counts.chapters !== chapters.length ||
      manifest.counts.progress !== progress.length) {
    throw new Error('The backup manifest counts do not match its contents.');
  }
  validateBackupRelationships(novels, chapters, progress, settings);
  return { novels, chapters, settings, progress };
}

/** Validate the central directory before JSZip can collapse duplicate names. */
function validateZipCentralDirectory(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const length = bytes.length;
  const eocdSignature = 0x06054b50;
  const firstCandidate = length - 22;
  const lastCandidate = Math.max(0, firstCandidate - 0xffff);
  let eocdOffset = -1;
  for (let offset = firstCandidate; offset >= lastCandidate; offset--) {
    if (offset + 22 > length || view.getUint32(offset, true) !== eocdSignature) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Missing ZIP end record.');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount ||
      entryCount !== BACKUP_FILES.length || entriesOnDisk === 0xffff || entryCount === 0xffff ||
      centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralSize !== eocdOffset || centralOffset > eocdOffset) {
    throw new Error('Unsupported ZIP layout.');
  }

  const seen = new Set<string>();
  const localRanges: Array<{ start: number; end: number }> = [];
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Malformed ZIP central directory.');
    }
    const neededVersion = view.getUint16(cursor + 6, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > centralEnd || nameLength === 0 || diskStart !== 0 ||
        compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff ||
        (neededVersion >= 45) || (method !== 0 && method !== 8) ||
        (flags & ~(0x0808 | (method === 8 ? 0x0006 : 0))) !== 0 || extraLength !== 0) {
      throw new Error('Unsupported ZIP entry.');
    }

    let name = '';
    for (let byteIndex = 0; byteIndex < nameLength; byteIndex++) {
      const charCode = bytes[cursor + 46 + byteIndex];
      if (charCode > 0x7f) throw new Error('Non-ASCII ZIP entry name.');
      name += String.fromCharCode(charCode);
    }
    if (!BACKUP_FILES.includes(name) || seen.has(name)) throw new Error('Unexpected or duplicate ZIP entry.');
    seen.add(name);

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('Malformed ZIP local header.');
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let dataEnd = dataStart + compressedSize;
    const usesDataDescriptor = (flags & 0x0008) !== 0;
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength ||
        localExtraLength !== 0 || dataStart > centralOffset || dataEnd > centralOffset ||
        (usesDataDescriptor
          ? (localCrc !== 0 && localCrc !== crc) ||
            (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
            (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
          : localCrc !== crc || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
      throw new Error('Inconsistent ZIP local header.');
    }
    for (let byteIndex = 0; byteIndex < nameLength; byteIndex++) {
      if (bytes[localOffset + 30 + byteIndex] !== bytes[cursor + 46 + byteIndex]) {
        throw new Error('ZIP local and central names differ.');
      }
    }
    if (usesDataDescriptor) {
      const hasSignature = dataEnd + 4 <= centralOffset && view.getUint32(dataEnd, true) === 0x08074b50;
      const signedDescriptorMatches = hasSignature && dataEnd + 16 <= centralOffset &&
        view.getUint32(dataEnd + 4, true) === crc &&
        view.getUint32(dataEnd + 8, true) === compressedSize &&
        view.getUint32(dataEnd + 12, true) === uncompressedSize;
      const unsignedDescriptorMatches = dataEnd + 12 <= centralOffset &&
        view.getUint32(dataEnd, true) === crc &&
        view.getUint32(dataEnd + 4, true) === compressedSize &&
        view.getUint32(dataEnd + 8, true) === uncompressedSize;
      if (signedDescriptorMatches) dataEnd += 16;
      else if (unsignedDescriptorMatches) dataEnd += 12;
      else {
        throw new Error('Malformed ZIP data descriptor.');
      }
    }
    localRanges.push({ start: localOffset, end: dataEnd });
    cursor = recordEnd;
  }

  if (cursor !== centralEnd || seen.size !== BACKUP_FILES.length ||
      BACKUP_FILES.some(name => !seen.has(name))) {
    throw new Error('ZIP central directory does not contain the required unique entries.');
  }
  localRanges.sort((left, right) => left.start - right.start);
  let expectedLocalOffset = 0;
  if (localRanges.length !== BACKUP_FILES.length) throw new Error('Unexpected ZIP local entry count.');
  for (const range of localRanges) {
    if (range.start !== expectedLocalOffset || range.end < range.start) {
      throw new Error('ZIP local entries contain gaps or overlaps.');
    }
    expectedLocalOffset = range.end;
  }
  if (expectedLocalOffset !== centralOffset) {
    throw new Error('ZIP local data does not end at the central directory.');
  }
}

/** Stream and cap the actual inflated bytes before retaining any further data. */
function readEntryText(entry: StreamableBackupEntry, maxBytes: number): Promise<{ text: string; byteLength: number }> {
  return new Promise<{ text: string; byteLength: number }>((resolve, reject) => {
    const stream = entry.internalStream('uint8array');
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try { stream.pause(); } catch { /* best-effort stop after failure */ }
      reject(error);
    };
    stream.on('data', chunk => {
      if (settled) return;
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > maxBytes - byteLength) {
        fail(new Error('Backup entry exceeds its size limit.'));
        return;
      }
      byteLength += chunk.byteLength;
      chunks.push(chunk);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({ text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), byteLength });
      } catch (error) { reject(error); }
    });
    try { stream.resume(); } catch (error) { fail(error); }
  });
}

function validateBackupRelationships(
  novels: Novel[], chapters: Chapter[], progress: ReadingProgress[],
  settings: ValidatedBackup['settings'],
): void {
  const novelsById = new Map<string, Novel>();
  for (const novel of novels) {
    if (novelsById.has(novel.id)) throw new Error('The backup contains duplicate novel IDs.');
    novelsById.set(novel.id, novel);
  }
  const chapterIds = new Set<string>();
  const chaptersById = new Map<string, Chapter>();
  for (const chapter of chapters) {
    const novel = novelsById.get(chapter.novelId);
    if (!novel || !novel.volumes.some(volume => volume.id === chapter.volumeId) || chapterIds.has(chapter.id)) {
      throw new Error('The backup contains an orphaned or duplicate chapter.');
    }
    chapterIds.add(chapter.id);
    chaptersById.set(chapter.id, chapter);
  }
  // Embedded catalog chapter rows must agree with the full chapter records.
  for (const novel of novels) {
    for (const reference of novel.chapters) {
      const full = chaptersById.get(reference.id);
      if (!full || full.novelId !== novel.id || full.volumeId !== reference.volumeId ||
          full.globalChapterNumber !== reference.globalChapterNumber ||
          full.volumeChapterNumber !== reference.volumeChapterNumber) {
        throw new Error('The backup has chapter references that do not match its full chapter records.');
      }
    }
    if (novel.chapters.length !== chapters.filter(chapter => chapter.novelId === novel.id).length) {
      throw new Error('The backup is missing chapter records for a personal book.');
    }
  }
  const progressIds = new Set<string>();
  for (const record of progress) {
    if (progressIds.has(record.novelId)) throw new Error('The backup contains duplicate reading progress.');
    progressIds.add(record.novelId);
    const novel = novelsById.get(record.novelId);
    if (novel) {
      const chapter = chaptersById.get(record.chapterId);
      if (!chapter || chapter.novelId !== record.novelId || chapter.volumeId !== record.volumeId ||
          chapter.globalChapterNumber !== record.globalChapterNumber) {
        throw new Error('The backup contains progress that does not match its personal book.');
      }
    }
  }
  if (settings.length > 1) throw new Error('The backup contains duplicate settings records.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isText(value: unknown): value is string { return typeof value === 'string'; }
function isNonEmptyText(value: unknown): value is string { return isText(value) && value.trim().length > 0; }
function isId(value: unknown): value is string { return isText(value) && ID_PATTERN.test(value); }
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(isText); }
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isText);
}

function isNovel(value: unknown): value is Novel {
  if (!isRecord(value) || !isId(value.id) || !isNonEmptyText(value.title) || !isText(value.originalTitle) ||
      !isStringArray(value.alternativeTitles) || !isNonEmptyText(value.author) || !isText(value.description) ||
      !isText(value.cover) || !isNonEmptyText(value.sourceLanguage) || !isNonEmptyText(value.translationLanguage) ||
      !['ongoing', 'completed', 'hiatus', 'dropped'].includes(String(value.status)) ||
      !isStringArray(value.genres) || !isStringArray(value.tags) || !Array.isArray(value.volumes) ||
      !Array.isArray(value.chapters) || !Array.isArray(value.downloads) ||
      !isNonNegativeInteger(value.createdAt) || !isNonNegativeInteger(value.updatedAt)) return false;
  const volumeIds = new Set<string>();
  for (const volume of value.volumes) {
    if (!isRecord(volume) || !isId(volume.id) || volume.novelId !== value.id ||
        !isPositiveInteger(volume.volumeNumber) || !isNonEmptyText(volume.title) ||
        !isNonNegativeInteger(volume.chapterCount) ||
        (volume.cover !== undefined && !isText(volume.cover)) ||
        (volume.downloadUrl !== undefined && !isText(volume.downloadUrl)) || volumeIds.has(volume.id)) return false;
    volumeIds.add(volume.id);
  }
  const embeddedIds = new Set<string>();
  for (const chapter of value.chapters) {
    if (!isRecord(chapter) || !isId(chapter.id) || chapter.novelId !== value.id || !isId(chapter.volumeId) ||
        !volumeIds.has(chapter.volumeId) || !isPositiveInteger(chapter.globalChapterNumber) ||
        !isPositiveInteger(chapter.volumeChapterNumber) || !isNonEmptyText(chapter.title) ||
        !isNonNegativeInteger(chapter.wordCount) ||
        (chapter.content !== undefined && !isText(chapter.content)) ||
        (chapter.metadata !== undefined && !isStringRecord(chapter.metadata)) || embeddedIds.has(chapter.id)) return false;
    embeddedIds.add(chapter.id);
  }
  const downloadIds = new Set<string>();
  for (const download of value.downloads) {
    if (!isRecord(download) || !isId(download.id) || download.novelId !== value.id ||
        !['complete', 'volume'].includes(String(download.type)) || !isNonEmptyText(download.label) ||
        !isText(download.url) || !isNonNegativeInteger(download.size) || !isNonEmptyText(download.language) ||
        (download.volumeId !== undefined && (!isId(download.volumeId) || !volumeIds.has(download.volumeId))) ||
        (download.type === 'volume' && !isId(download.volumeId)) || downloadIds.has(download.id)) return false;
    downloadIds.add(download.id);
  }
  return true;
}

function isChapter(value: unknown): value is Chapter {
  return isRecord(value) && isId(value.id) && isId(value.novelId) && isId(value.volumeId) &&
    isPositiveInteger(value.globalChapterNumber) && isPositiveInteger(value.volumeChapterNumber) &&
    isNonEmptyText(value.title) && isText(value.content) && isNonNegativeInteger(value.wordCount) &&
    isStringRecord(value.metadata);
}

function isProgress(value: unknown): value is ReadingProgress {
  return isRecord(value) && isId(value.novelId) && isId(value.chapterId) &&
    isPositiveInteger(value.globalChapterNumber) && isId(value.volumeId) &&
    typeof value.progress === 'number' && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 1 &&
    isNonNegativeInteger(value.scrollPosition) && isNonNegativeInteger(value.lastRead) &&
    typeof value.completed === 'boolean';
}

function isSettingsEntry(value: unknown): value is { key: 'user_settings'; value: UserSettings } {
  if (!isRecord(value) || value.key !== 'user_settings' || !isRecord(value.value)) return false;
  const settings = value.value;
  return THEMES.includes(String(settings.theme)) && typeof settings.fontSize === 'number' && Number.isFinite(settings.fontSize) && settings.fontSize >= 8 && settings.fontSize <= 72 &&
    typeof settings.lineHeight === 'number' && Number.isFinite(settings.lineHeight) && settings.lineHeight >= 1 && settings.lineHeight <= 3 &&
    isPositiveInteger(settings.readingWidth) && settings.readingWidth <= 2000 &&
    isNonNegativeInteger(settings.pageMargin) && settings.pageMargin <= 200 && isNonEmptyText(settings.fontFamily) &&
    typeof settings.infiniteScroll === 'boolean' && LOADING_STRATEGIES.includes(String(settings.readerLoadingStrategy));
}

function readExistingNovelIds(): Promise<Set<string>> {
  return withReadTransaction(['imported_novels'], (tx, resolve) => {
    const request = tx.objectStore('imported_novels').getAllKeys();
    request.onsuccess = () => resolve(new Set((request.result as IDBValidKey[]).filter((id): id is string => typeof id === 'string')));
  });
}

function withReadTransaction<T>(
  stores: string[], setup: (tx: IDBTransaction, resolve: (value: T) => void) => void,
): Promise<T> {
  return openStorageDB().then(db => new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, 'readonly'); }
    catch (error) { db.close(); reject(error); return; }
    let result: T;
    let hasResult = false;
    const setResult = (value: T) => { result = value; hasResult = true; };
    tx.oncomplete = () => { db.close(); hasResult ? resolve(result!) : reject(new Error('Could not read backup data.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not read backup data.')); };
    tx.onerror = () => { /* onabort handles the terminal error */ };
    try { setup(tx, setResult); }
    catch (error) { try { tx.abort(); } catch { db.close(); reject(error); } }
  }));
}

function restoreValidatedBackup(backup: ValidatedBackup): Promise<RestoreSummary> {
  return openStorageDB().then(db => new Promise<RestoreSummary>((resolve, reject) => {
    const stores = ['imported_novels', 'imported_chapters', 'reading_progress', 'settings'];
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, 'readwrite'); }
    catch (error) { db.close(); reject(error); return; }
    let summary: RestoreSummary | null = null;
    let firstError: DOMException | null = null;
    let setupError: unknown;
    const fail = (error: unknown) => { setupError = error; try { tx.abort(); } catch { db.close(); reject(error); } };
    tx.oncomplete = () => { db.close(); summary ? resolve(summary) : reject(new Error('Backup restore did not finish.')); };
    tx.onerror = () => { firstError ??= tx.error; };
    tx.onabort = () => { db.close(); reject(tx.error ?? firstError ?? setupError ?? new Error('Backup restore was rolled back.')); };
    try {
      const novelStore = tx.objectStore('imported_novels');
      const chapterStore = tx.objectStore('imported_chapters');
      const progressStore = tx.objectStore('reading_progress');
      const idRequest = novelStore.getAllKeys();
      const progressRequest = progressStore.getAll();
      let existingIds: Set<string> | null = null;
      let existingProgress: ReadingProgress[] | null = null;
      let scheduled = false;
      const scheduleWrites = () => {
        if (scheduled || !existingIds || !existingProgress) return;
        scheduled = true;
        try {
          const conflicts = new Set(backup.novels.filter(novel => existingIds!.has(novel.id)).map(novel => novel.id));
          const added = backup.novels.filter(novel => !conflicts.has(novel.id));
          const addedIds = new Set(added.map(novel => novel.id));
          const chapters = backup.chapters.filter(chapter => addedIds.has(chapter.novelId));
          for (const novel of added) novelStore.add(novel);
          for (const chapter of chapters) chapterStore.add(chapter);

          const currentProgress = new Map(existingProgress!.map(record => [record.novelId, record]));
          // Any existing personal import owns its progress, even when that ID
          // does not appear in this archive. Shared-title progress is eligible
          // only when there is no personal import with the same ID.
          const progressForRestore = backup.progress.filter(record => !existingIds!.has(record.novelId));
          let restoredProgress = 0;
          for (const record of progressForRestore) {
            const current = currentProgress.get(record.novelId);
            if (!current || record.lastRead > current.lastRead) {
              progressStore.put(record);
              restoredProgress++;
            }
          }
          for (const entry of backup.settings) tx.objectStore('settings').put(entry);
          summary = {
            addedNovels: added.length,
            addedChapters: chapters.length,
            skippedNovels: conflicts.size,
            restoredProgress,
          };
        } catch (error) { fail(error); }
      };
      idRequest.onsuccess = () => {
        existingIds = new Set((idRequest.result as IDBValidKey[]).filter((id): id is string => typeof id === 'string'));
        scheduleWrites();
      };
      progressRequest.onsuccess = () => { existingProgress = progressRequest.result as ReadingProgress[]; scheduleWrites(); };
    } catch (error) { fail(error); }
  }));
}

/**
 * Export the records owned by this device into a portable ZIP file.
 * Shared catalog snapshots and browser/service-worker caches are intentionally
 * excluded. The function performs no network requests and does not mutate data.
 */
export async function exportLibraryBackup(): Promise<Blob> {
  const snapshot = await readPersonalLibrarySnapshot();
  const manifest: LibraryBackupManifest = {
    format: 'yomi-library-backup',
    version: 1,
    exportedAt: Date.now(),
    counts: {
      novels: snapshot.novels.length,
      chapters: snapshot.chapters.length,
      progress: snapshot.progress.length,
    },
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('novels.json', JSON.stringify(snapshot.novels));
  zip.file('chapters.json', JSON.stringify(snapshot.chapters));
  zip.file('settings.json', JSON.stringify(snapshot.settings));
  zip.file('progress.json', JSON.stringify(snapshot.progress));

  const archive = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return archive.type === 'application/zip'
    ? archive
    : new Blob([archive], { type: 'application/zip' });
}

/** Read all included stores in one consistent readonly IndexedDB transaction. */
function readPersonalLibrarySnapshot(): Promise<LibraryBackupSnapshot> {
  return openStorageDB().then(db => new Promise<LibraryBackupSnapshot>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(
        ['imported_novels', 'imported_chapters', 'settings', 'reading_progress'],
        'readonly',
      );
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    const snapshot: LibraryBackupSnapshot = {
      novels: [],
      chapters: [],
      settings: [],
      progress: [],
    };
    let firstError: DOMException | null = null;
    let setupError: unknown;

    tx.oncomplete = () => {
      db.close();
      resolve(snapshot);
    };
    tx.onerror = () => {
      firstError ??= tx.error;
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? firstError ?? setupError ?? new Error('Could not read the device library for backup.'));
    };

    try {
      tx.objectStore('imported_novels').getAll().onsuccess = event => {
        snapshot.novels = (event.target as IDBRequest).result;
      };
      tx.objectStore('imported_chapters').getAll().onsuccess = event => {
        snapshot.chapters = (event.target as IDBRequest).result;
      };
      tx.objectStore('settings').getAll().onsuccess = event => {
        snapshot.settings = (event.target as IDBRequest).result;
      };
      tx.objectStore('reading_progress').getAll().onsuccess = event => {
        snapshot.progress = (event.target as IDBRequest).result;
      };
    } catch (error) {
      setupError = error;
      try {
        tx.abort();
      } catch {
        db.close();
        reject(error);
      }
    }
  }));
}
