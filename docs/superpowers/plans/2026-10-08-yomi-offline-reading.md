# Yomi Offline Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yomi's installed app shell and explicitly saved shared books available offline without putting readers' own EPUBs into disposable browser cache.

**Architecture:** A versioned service worker caches the production app shell and public catalog metadata. Readers opt individual shared titles into offline storage; metadata, covers, and chapters are stored in dedicated IndexedDB stores and served by the existing data layer when offline.

**Tech Stack:** Vite, TypeScript, Service Worker API, Web App Manifest, existing IndexedDB wrapper.

**Spec:** `docs/superpowers/specs/2026-10-08-yomi-static-publishing-and-offline-design.md`

## Global Constraints

- Add a web app manifest and service worker for the production app shell, icons, and offline fallback.
- Cache the shared catalog manifest and essential small static catalog metadata for offline library rendering.
- Let readers explicitly save a shared book for offline reading.
- Let readers explicitly save a shared book for offline reading. Store its required chapters and cover in IndexedDB, with clear storage feedback and a remove-offline action. Do not precache every shared EPUB by default.
- Personal EPUB imports are directly stored in IndexedDB; they are not treated as disposable service-worker cache entries.
- Make online-only and offline-available status clear, and handle failed/missing assets without blank screens.
- Keep cached app shell versioning and cleanup deterministic so new deployments update the UI without deleting user-owned IndexedDB data.

---

## File Structure

- Create `public/manifest.webmanifest`, `public/sw.js`, and `public/offline.html` — install metadata, cache rules, offline fallback.
- Modify `index.html` and `src/main.ts` — manifest link and production service-worker registration.
- Modify `src/storage/index.ts`; create `src/storage/offline-books.ts` — database upgrade and offline shared-book helpers.
- Modify `src/data/index.ts` — cached catalog and offline data fallback.
- Modify `src/pages/NovelPage.ts`, `src/components/NovelCard.ts`, and `src/styles/platform-redesign.css` — save/remove offline UI and indicator.
- Modify `README.md` — installation and offline behavior.

## Task 1: Add app manifest and service-worker lifecycle

**Files:**
- Create: `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`
- Modify: `index.html`, `src/main.ts`

- [ ] Add app name, short name, start URL, display mode, colors, and existing icon assets to the manifest.
- [ ] Register the service worker after app boot in production only; skip registration on Vite dev origin.
- [ ] During install, fetch `/`, parse its module script and stylesheet URLs, and add those emitted JS/CSS assets together with the manifest, icons, and offline page to the versioned shell cache.
- [ ] Use cache-first for versioned shell assets, network-first for `/data/novels.json`, and network-only for unrelated requests.
- [ ] During activation delete only older caches with Yomi's cache prefix; never touch IndexedDB.
- [ ] Use the offline fallback only for failed navigation requests; do not cache POSTs or personal import payloads.

## Task 2: Store shared books selected for offline reading

**Files:**
- Modify: `src/storage/index.ts`
- Create: `src/storage/offline-books.ts`

**Interfaces:**
- `saveSharedNovelOffline(novel: Novel, chapters: Chapter[]): Promise<void>` writes a shared novel snapshot and chapters atomically.
- `getSavedSharedNovel(novelId: string): Promise<Novel | undefined>` reads the local snapshot.
- `getSavedSharedChapters(novelId: string): Promise<Chapter[]>` returns chapters sorted by global number.
- `removeSharedNovelOffline(novelId: string): Promise<void>` removes only that saved shared copy.
- `isSharedNovelSaved(novelId: string): Promise<boolean>` reports save state.

- [ ] Upgrade IndexedDB from version 3 with `offline_shared_novels` keyed by `id` and `offline_shared_chapters` keyed by `id` with `novelId` index.
- [ ] Keep current stores and import/progress migration paths intact.
- [ ] Save novel and all chapters in one `readwrite` transaction; remove both stores' entries in one transaction.
- [ ] Sort retrieved chapters by `globalChapterNumber`; close the database on completion/error.
- [ ] Preserve reading progress when an offline shared copy is removed.

## Task 3: Add save/remove offline controls

**Files:**
- Modify: `src/pages/NovelPage.ts`, `src/styles/platform-redesign.css`
- Modify: `src/storage/offline-books.ts`

- [ ] Add “Save for offline” on shared novel pages and “Remove offline copy” when saved.
- [ ] Fetch the shared novel and chapter JSON plus its cover bytes; convert the cover to a data URL and save the snapshot with that local cover through `saveSharedNovelOffline`.
- [ ] Disable duplicate actions while saving and show progress, storage/quota errors, and retry affordance.
- [ ] Keep shared snapshots separate from `imported_novels` so personal imports remain independent.
- [ ] On remove, update the UI and leave progress/settings untouched.

## Task 4: Read the shared catalog and chapters offline

**Files:**
- Modify: `src/data/index.ts`, `src/pages/LibraryPage.ts`, `src/components/NovelCard.ts`

- [ ] Fetch the catalog through the service worker's network-first route; use its cached copy if offline.
- [ ] If chapter fetch fails, use the matching saved shared novel and chapters from IndexedDB before showing an error.
- [ ] Keep sources distinct: static shared record online, saved shared snapshot as offline fallback, personal import from the existing personal stores.
- [ ] Load saved IDs once per library render and show offline status only for saved books.
- [ ] Show a clear online-required state for a shared title without local chapter data when the network is unavailable.

## Task 5: Document offline use and build the production output

**Files:**
- Modify: `README.md`
- Verify: `dist/manifest.webmanifest`, `dist/sw.js`, `dist/offline.html`

- [ ] Document HTTPS/localhost requirements, the first online visit, per-book saving, cache behavior, and browser storage limitations.
- [ ] Run `npm run build`; confirm the manifest, service worker, and offline page are emitted at expected paths.
- [ ] Confirm worker cache cleanup is scoped to Yomi cache names and never deletes IndexedDB.
- [ ] Confirm personal imports still load from IndexedDB and do not appear in Cache Storage.

## Acceptance / verification

- First online visit installs the app shell; subsequent offline visits show Yomi's shell and cached catalog.
- A reader can save a shared title online, read it offline, and remove its saved copy.
- Unsaved shared titles are clearly marked online-only offline.
- Cache updates never delete user-owned books, covers, settings, or progress.
