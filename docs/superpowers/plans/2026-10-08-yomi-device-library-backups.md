# Yomi Device Library and Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect reader-owned EPUB imports and progress in local IndexedDB, request persistent browser storage, and provide local backup and restore.

**Architecture:** Keep personal books, chapters, covers, settings, and progress in IndexedDB. Request origin persistence where supported and create a versioned ZIP backup with the existing JSZip dependency; restore from a locally selected file after validation and conflict review.

**Tech Stack:** TypeScript, IndexedDB, Storage Manager API, existing JSZip dependency and personal EPUB importer.

**Spec:** `docs/superpowers/specs/2026-10-08-yomi-static-publishing-and-offline-design.md`

## Global Constraints

- The deployed reader's Add Book flow is separate from publishing. Reader-selected EPUBs, covers, chapters, and reading progress remain in local IndexedDB and are never uploaded.
- Save a novel and all its chapter records in one transaction so failed imports do not leave partial library entries.
- On supported browsers, request persistent origin storage using the Storage Manager API. Explain the outcome in simple language; it reduces automatic eviction risk but cannot guarantee that the browser, operating system, or user will never clear site data.
- Add a user-controlled backup and restore flow for personal books, covers, settings, and reading progress. Backups are generated and selected locally. They are never sent to the server.
- Validate backup contents and IDs before restoring, report conflicts, and restore records transactionally where practical.
- Do not delete user-imported records from any browser's IndexedDB as part of this cleanup; those are private user content, not shared demo assets.
- Never show import/restore success after a quota or storage failure.

---

## File Structure

- Modify `src/storage/index.ts` — persistence, quota, and DB helpers.
- Create `src/storage/backup.ts` — versioned archive export/inspection/restore.
- Modify `src/pages/AdminPage.ts`, `src/styles/admin.css`, and, if navigation needs it, `src/components/Navbar.ts` — local library storage/backups UI.
- Modify `README.md` — storage guarantees and recovery steps.

## Task 1: Add persistent-storage and quota helpers

**Files:**
- Modify: `src/storage/index.ts`

**Interfaces:**
- `requestPersistentStorage(): Promise<{ supported: boolean; granted: boolean }>` handles missing API/rejection without failing app startup.
- `getStorageEstimate(): Promise<{ usage?: number; quota?: number }>` returns available estimate fields or an empty result.

- [ ] Feature-detect `navigator.storage.persist()` and `navigator.storage.estimate()`.
- [ ] Keep the request non-blocking and convert denial/unsupported outcomes into ordinary status values.
- [ ] Preserve distinctions for `QuotaExceededError` and transaction aborts in personal EPUB import.

## Task 2: Define and export the versioned local backup archive

**Files:**
- Create: `src/storage/backup.ts`
- Modify: `src/storage/index.ts`

**Interfaces:**
- `exportLibraryBackup(): Promise<Blob>` emits a ZIP containing `manifest.json`, `novels.json`, `chapters.json`, `settings.json`, and `progress.json`.
- Manifest schema: `{ format: 'yomi-library-backup', version: 1, exportedAt: number, counts: { novels: number, chapters: number, progress: number } }`.

- [ ] Read only personal imported stores, settings, and progress; exclude public catalog content and service-worker caches.
- [ ] Serialize archive with JSZip and return an `application/zip` Blob.
- [ ] Trigger download as `yomi-library-backup-YYYY-MM-DD.zip` from a user action and revoke its object URL.
- [ ] Report export failures without mutating local records.

## Task 3: Validate restore archives and avoid overwriting books

**Files:**
- Modify: `src/storage/backup.ts`, `src/storage/index.ts`

**Interfaces:**
- `inspectLibraryBackup(file: File): Promise<BackupPreview>` returns counts and conflicting novel IDs.
- `restoreLibraryBackup(file: File, conflictPolicy: 'skip-existing'): Promise<RestoreSummary>` restores valid non-conflicting records and settings.
- `BackupPreview` is `{ novels: number; chapters: number; progress: number; conflicts: string[] }`.
- `RestoreSummary` is `{ addedNovels: number; addedChapters: number; skippedNovels: number; restoredProgress: number }`.

- [ ] Reject non-ZIP files, unsupported versions, missing entries, malformed JSON, invalid IDs, orphan chapters, and malformed progress records before opening a write transaction; allow progress for shared novels that are not personal imports.
- [ ] Preview counts/collisions; `skip-existing` prevents silent replacement of a personal book.
- [ ] Restore novels, chapters, progress, and settings in a single IndexedDB transaction; on abort show failure and preserve existing records.
- [ ] Clear/reload data caches after successful restore.
- [ ] Explain duplicate skips and show a summary after restore.

## Task 4: Add storage status and backup controls

**Files:**
- Modify: `src/pages/AdminPage.ts`, `src/styles/admin.css`
- Modify: `src/components/Navbar.ts` only if another navigation entry is required

- [ ] Add “Your device library” with persistent-storage status, quota estimate when available, and a plain note that clearing site data can erase local books.
- [ ] Add “Download backup” and “Restore backup”; show inspection counts/conflicts before the final restore confirmation.
- [ ] Present progress and success/error state through an accessible live region.
- [ ] Keep all file processing local; make no network requests with personal data.
- [ ] Ensure controls remain keyboard-accessible and usable on mobile.

## Task 5: Document recovery behavior and build

**Files:**
- Modify: `README.md`

- [ ] Document local imports, best-effort browser persistence, safe backup storage, and duplicate-skip behavior on restore.
- [ ] Run `npm run build` and confirm backup APIs type-check without changing the EPUB import format.
- [ ] Inspect the archive implementation to confirm it reads personal stores only.
- [ ] Confirm restore failures report an error and do not show partial success.

## Acceptance / verification

- Personal imports and progress survive reloads and work offline in the same browser profile.
- Yomi requests persistent storage where supported and does not promise permanent storage.
- Export produces a local backup with books, chapters, covers, settings, and progress.
- Restore validates before writing, skips collisions, preserves existing data, and never uploads the archive.
