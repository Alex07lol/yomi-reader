/* ─── Core Domain Models ─── */

export interface Novel {
  id: string;
  title: string;
  originalTitle: string;
  alternativeTitles: string[];
  author: string;
  description: string;
  cover: string;               // path or URL
  sourceLanguage: string;
  translationLanguage: string;
  status: NovelStatus;
  genres: string[];
  tags: string[];
  volumes: Volume[];
  chapters: Chapter[];
  downloads: Download[];
  createdAt: number;            // unix ms
  updatedAt: number;
}

export type NovelStatus = 'ongoing' | 'completed' | 'hiatus' | 'dropped';

export interface Volume {
  id: string;
  novelId: string;
  volumeNumber: number;
  title: string;
  cover?: string;
  chapterCount: number;
  downloadUrl?: string;
}

export interface Chapter {
  id: string;                   // stable, never changes
  novelId: string;
  volumeId: string;
  globalChapterNumber: number;  // 1-based across the whole novel
  volumeChapterNumber: number;  // 1-based within its volume
  title: string;
  content: string;              // HTML string
  wordCount: number;
  metadata: Record<string, string>;
}

export interface Download {
  id: string;
  novelId: string;
  type: 'complete' | 'volume';
  volumeId?: string;
  label: string;
  url: string;
  size: number;                 // bytes
  language: string;
}

/* ─── Reading Progress ─── */

export interface ReadingProgress {
  novelId: string;
  chapterId: string;
  globalChapterNumber: number;
  volumeId: string;
  progress: number;             // 0–1 within the chapter
  scrollPosition: number;      // px offset within the chapter block
  lastRead: number;             // unix ms
  completed: boolean;
}

/* ─── User Settings ─── */

export interface UserSettings {
  theme: ThemeId;
  fontSize: number;             // px
  lineHeight: number;           // unitless
  readingWidth: number;         // px (max-width of reader column)
  pageMargin: number;           // px
  fontFamily: string;           // 'serif' | 'sans' | 'mono'
  textAlign: ReaderTextAlign;   // paragraph alignment
  paragraphSpacing: number;     // em between paragraphs
  letterSpacing: number;        // px
  infiniteScroll: boolean;
  readerLoadingStrategy: ReaderLoadingStrategy;
}

export type ReaderTextAlign = 'left' | 'justify';

export type ReaderLoadingStrategy = 'balanced' | 'lightweight' | 'preload';

/* ─── Reading shelves ─── */

export type ShelfId = 'want' | 'reading' | 'finished' | 'dropped';

/** A novel's placement on one shelf. `updatedAt` drives last-write-wins sync. */
export interface ReadingShelf {
  novelId: string;
  shelf: ShelfId;
  updatedAt: number;            // unix ms
  /** Local/remote tombstone: the novel was removed from every shelf. */
  deleted?: boolean;
}

export type ThemeId = 'midnight' | 'dark' | 'light' | 'oled' | 'sepia' | 'system';

/* ─── Filter / Sort types ─── */

export interface LibraryFilters {
  search: string;
  genres: string[];
  tags: string[];
  sourceLanguages: string[];
  translationLanguages: string[];
  status: NovelStatus[];
  shelves: ShelfId[];
  sort: SortOption;
}

export type SortOption = 'recently-added' | 'recently-updated' | 'alphabetical' | 'chapter-count';

/* ─── Available option lists (extensible from data) ─── */

export interface LibraryOptions {
  genres: string[];
  tags: string[];
  sourceLanguages: string[];
  translationLanguages: string[];
}
