# Yomi Static Publishing and Offline Design

## Goal

Prepare Yomi for a public static deployment with a shared catalog that the owner can update from their computer, while keeping each reader's personal imports and reading data on that reader's device. The app should remain usable offline, and the published catalog should contain no sample/demo novels.

## Decisions

- Use static hosting, targeting Cloudflare Pages Direct Upload with Wrangler as the initial deployment path. No application backend, hosted upload endpoint, user accounts, or cloud sync are introduced.
- Keep deployment credentials on the owner's computer through Wrangler authentication. Never include credentials in built client assets or in the public repository.
- Provide a polished owner-only publishing interface that runs locally. It accepts an EPUB, a cover image, and catalog metadata; validates and previews the book; adds the resulting catalog files; and builds/deploys the static site after explicit owner confirmation.
- The deployed reader's Add Book flow is separate from publishing. Reader-selected EPUBs, covers, chapters, and reading progress remain in local IndexedDB and are never uploaded.
- Keep *The Unemployed Demon Lord* in the shared catalog. Remove the five demo novels: *The Fox's Tale*, *Neon Relic*, *The Shadow Prince*, *The Jade Empress*, and *Stars Beyond the Veil*, including their demo chapter, cover, and downloadable EPUB files.

## Static shared catalog and publishing flow

Shared books are static public content. Each published entry has a stable ID, EPUB asset, cover image, metadata, and parsed chapter data required by the reader. The catalog manifest is the source of truth for the library. New books append to it; publishing must not replace existing entries or *The Unemployed Demon Lord*. Stable IDs and duplicate checks prevent accidental overwrites.

The local publisher presents a clear sequence: choose EPUB and cover, enter or review metadata, preview the catalog listing, validate sizes and identifiers, and confirm publishing. It writes the book and catalog changes into the static source tree, runs the production build, then deploys the build output with Wrangler to the configured Pages project. Build or deploy failure must leave the last deployed version usable and show a useful error. A preview build/deployment should be available before production publishing where supported.

The publisher is not part of the public production app. It runs only on the owner's computer and does not provide a network upload service. Any local UI service binds to loopback only. Public catalog EPUBs and covers are intentionally downloadable by site visitors. The publisher checks Cloudflare's current per-file upload limit (25 MiB at design time) and fails before deployment with an actionable message if a file is too large. The storage format should allow a later asset-host change if individual books outgrow static-host limits.

The reader fetches catalog entries and their chapters from static assets. New deployments update the shared catalog for everyone; there is no live database mutation.

## Personal library and durable local storage

Continue using IndexedDB for imported novel records, chapter content, settings, and progress. Save a novel and its chapters in one transaction so a failed write cannot leave an incomplete book. Store imported cover data with its local novel record. Check storage availability and quota before or during import and report failures without showing success.

On supported browsers, request persistent origin storage using the Storage Manager API. Explain the outcome in simple language; it reduces automatic eviction risk but cannot guarantee that the browser, operating system, or user will never clear site data.

Add a user-controlled backup and restore flow for personal books, covers, settings, and reading progress. Backups are generated and selected locally. They are never sent to the server. Validate backup contents and IDs before restoring, report conflicts, and restore records transactionally where practical.

## Offline behavior

- Add a web app manifest and service worker for the production app shell, icons, and offline fallback.
- Cache the shared catalog manifest and essential small static catalog metadata for offline library rendering.
- Let readers explicitly save a shared book for offline reading. Store its required chapters and cover in IndexedDB, with clear storage feedback and a remove-offline action. Do not precache every shared EPUB by default.
- Personal EPUB imports are directly stored in IndexedDB; they are not treated as disposable service-worker cache entries.
- Make online-only and offline-available status clear, and handle failed/missing assets without blank screens.
- Keep cached app shell versioning and cleanup deterministic so new deployments update the UI without deleting user-owned IndexedDB data.

## Demo catalog removal

Remove these IDs from the static catalog: `foxs-tale`, `neon-relic`, `shadow-prince`, `jade-empress`, and `stars-beyond`. Remove their public demo chapter files, demo covers, and demo EPUB downloads when no remaining catalog reference uses them. Preserve all assets and chapters for `the-unemployed-demon-lord`.

Demo material must also be removed from library examples, hard-coded UI references, and newly generated deployments. Do not delete user-imported records from any browser's IndexedDB as part of this cleanup; those are private user content, not shared demo assets.

## Deployment readiness

- Configure a reproducible production build and Cloudflare Pages deployment command for Vite's `dist` output.
- Add production routing fallback so client-side routes such as `#library`, novel pages, and reader pages work after refresh/deep link.
- Ensure service worker registration is production-only and test its update path.
- Document local development, publishing, preview, production deployment, storage behavior, and recovery from a failed deployment.
- Keep Cloudflare credentials out of files committed to source control; use Wrangler's local login or a narrowly-scoped credential mechanism only when needed.
- A production deployment is not performed as part of implementation unless the owner explicitly requests and supplies the required target project/account setup.

## Out of scope

- Backend APIs, server-side book uploads, accounts, or synchronization of personal imports.
- Publishing secrets or an admin login embedded in the public app.
- Automatically downloading every shared EPUB for every reader.
- Editing or deleting personal books through a cloud service.
- Guaranteeing permanent local storage against users clearing browser data or device loss; backup/restore is the recovery path.

## Acceptance checks

1. A local publishing flow accepts an EPUB and cover, validates metadata and duplicate IDs, previews the result, adds rather than replaces catalog entries, builds the site, and can deploy to the configured static host.
2. A deployment failure leaves the current production release intact and provides a clear recovery message.
3. The built public app contains no publishing credentials or production owner-publishing page.
4. The shared catalog contains *The Unemployed Demon Lord* and none of the five listed demo novels; their unused demo assets are removed from the deployment.
5. A reader's imported books and progress survive app reloads and offline use, and the app requests persistent storage where supported.
6. A reader's personal books never enter the shared catalog, network requests, or publishing bundle.
7. Backup/export and restore/import work locally, validate data, and provide actionable error states.
8. The production app shell opens offline after it has been installed/visited online; saved shared books remain readable offline; unsaved content is clearly identified as online-only.
9. Existing reader, library, search, progress, and import behavior remains functional for the retained shared book and local imports.
10. Production build and deployment instructions are reproducible from a clean checkout.

## Self-review

- The design keeps the two similarly named workflows separate: the owner publishes shared static content from a local tool, while readers import personal content into their own IndexedDB.
- The no-backend security goal is preserved; public catalog files are intentionally public, and deployment credentials never reach the browser.
- Local persistence is described honestly: the browser can grant persistent storage, but export/restore is still needed for device loss or explicit data clearing.
- Offline caching is selective: application assets and catalog metadata are cached, personal content uses IndexedDB, and shared books are stored offline only when the reader asks.
- Cleanup names exact demo IDs and explicitly protects *The Unemployed Demon Lord* and all private browser data.
- Cloudflare's 25 MiB per-file limit is time-sensitive and must be rechecked during implementation; the chosen storage format permits moving larger assets later.
