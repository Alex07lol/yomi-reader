# Yomi Reader Local Import and Theme Design

## Goal

Make the library footer quiet, give readers a clear way to add books, and turn the existing EPUB parser into a complete local import flow. Let an uploaded cover override the EPUB cover. Also make Midnight and Dark visibly distinct choices.

## User experience

- Remove the footer tagline and local-storage subtitle. Move **Import EPUB** from the footer to an **Add book** action in the library navigation area. Keep the Yomi brand as the route back to the library.
- Redesign the import page as a focused, responsive workflow: an EPUB drop zone and file picker; an optional image cover picker; a visible cover preview; metadata and chapter-count review; and a clear **Add to library** action. Support replacing/removing the selected cover before import.
- Keep existing EPUB cover extraction as the default. A supplied cover image takes precedence. Provide specific parse/validation/storage errors beside the relevant step and a completion state with a route back to the library or the imported book.
- Imports remain local to this browser and require no account. The UI should communicate this briefly on the import screen rather than repeating it in the library footer.

## Local persistence and data flow

- Extend the existing IndexedDB database with stores for imported novel records and imported chapter content. Add an index by novel ID for chapter retrieval. Upgrade the database version without dropping current reading progress or settings.
- Save a novel and all its chapter records in one read/write transaction so failed imports do not leave partial library entries. Use stable, collision-checked IDs and report duplicates instead of silently overwriting another book.
- Merge imported novel records with the bundled catalog in the data layer. Read bundled chapters from their existing static JSON files and imported chapters from IndexedDB. Preserve chapter order and the existing `Novel`/`Chapter` contracts so the novel page, reader, progress tracking, search, sorting, filters, and continue-reading views work with either source.
- Keep the current built-in data and the already-added *The Unemployed Demon Lord* entry intact. Saving a cover and long chapter sets must handle storage errors without presenting a success state.

## Theme distinction

- Midnight becomes a deep cool blue-charcoal palette with lighter cool text and a distinct muted blue-lavender accent.
- Dark remains the current neutral graphite palette and soft blue accent. Light, OLED Black, Sepia, and System retain their existing intent.
- Scope theme tokens so Midnight and Dark each override the shared platform tokens, including surfaces, text, borders, accent, and reader background. Verify menus, cards, import surfaces, and reader content all follow the selected palette.

## Implementation boundaries

- Update the admin/import page and its presentation styles, the library navigation/footer placement, IndexedDB schema and helper methods, and the data abstraction that merges local books with bundled books.
- Update theme token selectors and the theme dropdown labels only as needed; do not add accounts, cloud sync, book editing/deletion, or backend services.
- Keep EPUB parsing in the existing parser. The uploaded cover is image data stored with the imported novel, not written to an external service.

## Acceptance checks

1. The library no longer shows the two footer text lines or the footer import link; **Add book** is easy to find and routes to the import screen.
2. EPUB drag/drop and file picking parse metadata and chapters; the optional image picker previews, replaces, and clears a cover; the supplied cover is used in library cards and the novel page.
3. A successful import persists across reloads, appears in search/filter/sort, opens its chapter list and reader, and preserves reading progress.
4. Failed parse, duplicate ID, and IndexedDB quota/storage failures show actionable errors and do not create a partial novel.
5. Existing bundled novels and the current *The Unemployed Demon Lord* book continue to load.
6. Midnight and Dark have visibly distinct surfaces and accents across library, import, and reader screens; other themes still apply.
7. Build succeeds and the key import/theme flows are checked in the running preview.

## Self-review

- The import transaction covers both novel and chapter records, preventing a visible title without readable chapters.
- The precedence rule is explicit: uploaded cover, then EPUB-embedded cover.
- The design preserves bundled catalog behavior and existing settings/progress during the IndexedDB version upgrade.
- Git commit is not part of this artifact because the project directory has no `.git` repository.
