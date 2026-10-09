# Yomi Reader — Design Specification

## Overview

A minimal, premium web platform for hosting and reading translated light novels. Built with vanilla TypeScript/Vite, it provides a clean reading experience focused on discoverability, comfortable reading, and automatic progress persistence.

## Design Principles

- **Minimal & Premium**: Black/white/gray color palette with restrained accent color
- **Kindle-like Reading**: Clean typography, focused reading experience
- **Multi-novel**: Not designed around one novel — supports arbitrary novels, languages, volumes, chapters
- **Automatic Persistence**: Reading progress saved without accounts
- **Accessibility**: Semantic HTML, keyboard navigation, ARIA labels
- **Performance**: Incremental loading for long novels

## Architecture

### Data Models

```typescript
Novel {
  id, title, originalTitle, alternativeTitles[], author, description,
  cover, sourceLanguage, translationLanguage, status,
  genres[], tags[], volumes[], chapters[], downloads[],
  createdAt, updatedAt
}

Chapter {
  id (stable), novelId, volumeId, globalChapterNumber,
  volumeChapterNumber, title, content (HTML), wordCount, metadata
}

ReadingProgress {
  novelId, chapterId, globalChapterNumber, volumeId,
  progress (0-1), scrollPosition, lastRead, completed
}
```

### Core Subsystems

1. **Reader Engine**: Infinite scroll with IntersectionObserver tracking
2. **Storage Layer**: IndexedDB for progress, settings persistence
3. **Theme System**: CSS custom properties + JS-based system theme
4. **Data Layer**: Abstract fetch layer (swappable for REST/DB)
5. **EPUB Pipeline**: Parse → extract metadata → detect chapters/volumes
6. **Router**: Hash-based SPA navigation with deep linking

## Components

| Component | Responsibility |
|-----------|---------------|
| Navbar | Site navigation, brand, theme selector |
| NovelCard | Library entry with cover, metadata, progress |
| NovelGrid | Responsive grid of novel cards |
| LibraryFilters | Search, genre/tag/language/status filters |
| ContinueReading | In-progress novels section |
| NovelHeader | Detailed novel info with actions |
| VolumeList | Expandable volume/chapter navigation |
| ChapterDrawer | Slide-in chapter browser |
| Reader | Infinite scroll reader with settings |
| ReaderSettings | Font, theme, layout customization |
| DownloadPanel | EPUB download options |
| ThemeSelector | Theme toggle buttons |
| Footer | Site footer with admin link |

## Pages

- `/library` — Novel library with filters, continue reading section
- `/novel/:id` — Novel detail page with volumes/chapters, downloads
- `/reader/:novelId/:chapterId` — Infinite scroll reader
- `/admin` — EPUB import workflow (upload → review → publish)

## Theme System

Themes defined via CSS custom properties on `:root`:
- **Midnight** (default): Dark gray tones
- **Dark**: Slightly lighter dark
- **Light**: White/light gray background
- **OLED Black**: Pure black background
- **Sepia**: Warm paper-like tones
- **System**: Follows OS preference (dark/light)

Settings persist via IndexedDB and apply immediately.

## Reader Features

- **Infinite Scroll**: Chapters load dynamically as user scrolls
- **Chapter Tracking**: IntersectionObserver determines current chapter
- **Auto-Save**: Debounced progress saving (400ms)
- **URL Deep Linking**: Each chapter has stable URL
- **Settings**: Font size, line height, width, margins, font family
- **Keyboard**: Arrow keys, Home/End, Escape
- **Touch**: Swipe gestures for chapter navigation
- **Mobile**: Bottom control bar with prev/drawer/next

## EPUB Import Architecture

Workflow: Upload EPUB → Parse → Extract metadata → Detect chapters → Detect volumes → Create novel record → Review metadata → Publish

Uses JSZip for parsing, extracts OPF metadata, spine for chapters, cover image. Admin page provides review step before publishing.

## Performance

- Lazy-load chapter content
- Virtualize long reading sessions
- Cache recently accessed chapters
- Avoid loading entire EPUBs into memory
- Debounced storage writes

## Accessibility

- Semantic HTML with proper heading hierarchy
- Keyboard navigation support
- ARIA labels on interactive elements
- Sufficient color contrast
- Respects prefers-reduced-motion
- Screen-reader-friendly chapter navigation