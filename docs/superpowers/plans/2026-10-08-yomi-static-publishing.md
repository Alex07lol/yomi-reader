# Yomi Static Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a multi-book shared catalog from an owner-only local panel to static Cloudflare Pages, while removing demo books and keeping *The Unemployed Demon Lord*.

**Architecture:** Keep published book metadata, chapters, covers, and EPUBs as static assets. A separate local publisher UI uses the existing EPUB parser and a loopback-only local Node process to write catalog files, run the Vite build, and invoke Wrangler. The public app contains no publishing surface or deployment credential.

**Tech Stack:** TypeScript, Vite, existing `jszip` EPUB parser, Node.js built-in HTTP/process APIs, Cloudflare Wrangler, JSON static catalog.

**Spec:** `docs/superpowers/specs/2026-10-08-yomi-static-publishing-and-offline-design.md`

## Global Constraints

- Use static hosting, targeting Cloudflare Pages Direct Upload with Wrangler as the initial deployment path.
- No application backend, hosted upload endpoint, user accounts, or cloud sync are introduced.
- Keep deployment credentials on the owner's computer through Wrangler authentication. Never include credentials in built client assets or in the public repository.
- Provide a polished owner-only publishing interface that runs locally. It accepts an EPUB, a cover image, and catalog metadata; validates and previews the book; adds the resulting catalog files; and builds/deploys the static site after explicit owner confirmation.
- The deployed reader's Add Book flow is separate from publishing. Reader-selected EPUBs, covers, chapters, and reading progress remain in local IndexedDB and are never uploaded.
- Keep *The Unemployed Demon Lord* in the shared catalog. Remove the five demo novels: *The Fox's Tale*, *Neon Relic*, *The Shadow Prince*, *The Jade Empress*, and *Stars Beyond the Veil*, including their demo chapter, cover, and downloadable EPUB files.
- The publisher checks Cloudflare's current per-file upload limit (25 MiB at design time) and fails before deployment with an actionable message if a file is too large.
- A production deployment is not performed as part of implementation unless the owner explicitly requests and supplies the required target project/account setup.

---

## File Structure

- Modify `public/data/novels.json` — shared catalog manifest.
- Delete: `public/data/chapters/foxs-tale.json`, `jade-empress.json`, `neon-relic.json`, `shadow-prince.json`, `stars-beyond.json`.
- Delete: `public/covers/foxs-tale.svg`, `jade-empress.svg`, `neon-relic.svg`, `shadow-prince.svg`, `shadow-prince.jpg`, `stars-beyond.svg`.
- Delete: `public/data/epubs/jade-empress-complete.epub`, `jade-empress-v1.epub`, `jade-empress-v2.epub`, `neon-relic-v1.epub`, `shadow-prince-complete.epub`, `shadow-prince-v1.epub`, `shadow-prince-v2.epub`, `stars-beyond-complete.epub`.
- Preserve `public/data/chapters/the-unemployed-demon-lord.json` and `public/data/epubs/the-unemployed-demon-lord.epub`.
- Create `tools/publisher/index.html`, `tools/publisher/vite.config.ts`, `tools/publisher/src/main.ts`, and `tools/publisher/src/style.css` — separate local publisher frontend.
- Create `tools/publisher/server.mjs` — loopback-only local file/catalog/build/deploy service.
- Create `tools/publisher/catalog.mjs` — validation and atomic catalog-writing functions.
- Create `tools/publisher/publisher.config.example.json` — non-secret Cloudflare project configuration.
- Modify `package.json` and `package-lock.json` — pinned Wrangler dependency and publisher/build/deploy scripts.
- Modify `.gitignore` and `README.md` — ignore local publisher config and document publishing/deployment.

## Task 1: Remove demo catalog entries and assets

**Files:**
- Modify: `public/data/novels.json`
- Delete: `public/data/chapters/foxs-tale.json`, `jade-empress.json`, `neon-relic.json`, `shadow-prince.json`, `stars-beyond.json`
- Delete: demo-only covers and EPUBs in `public/covers/` and `public/data/epubs/`

- [ ] Remove only the five named demo records from `novels.json`.
- [ ] Search retained records for each demo asset filename before deletion.
- [ ] Delete the five demo chapter files and only EPUB/cover files belonging to those IDs.
- [ ] Confirm `the-unemployed-demon-lord` remains in the manifest and its chapter/EPUB/cover assets remain.
- [ ] Run `npm run build` to ensure the retained catalog still packages.

## Task 2: Add publisher catalog validation and file writing

**Files:**
- Create: `tools/publisher/catalog.mjs`
- Create: `tools/publisher/publisher.config.example.json`
- Modify: `.gitignore`

**Interfaces:**
- `readCatalog(root): Promise<Novel[]>` reads `public/data/novels.json` from the configured project root.
- `validatePublication({ id, novel, chapters, epubBytes, coverBytes, root }): Promise<void>` rejects invalid IDs, missing metadata/chapters/assets, duplicates, oversized files, and paths outside the project root.
- `publishCatalogEntry({ root, novel, chapters, epubBytes, coverBytes }): Promise<void>` stages all assets, appends the novel to the existing manifest, then renames staged files into place; it never overwrites a colliding ID.

- [ ] Restrict IDs to lowercase letters, digits, and hyphens; resolve every destination and reject paths outside the project root.
- [ ] Parse the existing catalog and reject duplicate IDs before writing.
- [ ] Build a `Novel` record and chapter JSON using `src/models/Novel.ts` fields; set cover and download URLs to local static paths.
- [ ] Check EPUB and cover size against a single 25 MiB constant and report actual size on rejection.
- [ ] Write assets and a temporary manifest to a unique staging directory; rename into place only after all writes succeed.
- [ ] Ignore local publisher configuration and staging; the sample config has a project name field but no API token field.

## Task 3: Create the owner-only local publisher panel

**Files:**
- Create: `tools/publisher/index.html`, `tools/publisher/vite.config.ts`
- Create: `tools/publisher/src/main.ts`, `tools/publisher/src/style.css`
- Create: `tools/publisher/server.mjs`
- Modify: `package.json`

**Interfaces:**
- Frontend imports `parseEpub` from `src/epub-import/index.ts` and previews title, author, language, chapter count, and selected cover.
- Local service binds only to `127.0.0.1` and serves the publisher build plus `GET /api/catalog`, `POST /api/stage/epub`, `POST /api/stage/cover`, `POST /api/publish`, `POST /api/build`, and `POST /api/deploy`.
- `POST /api/stage/epub` and `/api/stage/cover` accept capped raw binary data into a private staging directory; `POST /api/publish` accepts validated JSON metadata/chapter data and commits the staged files through `catalog.mjs`.
- `POST /api/build` runs the fixed `npm run build` command with the project root as cwd.
- `POST /api/deploy` runs the fixed Wrangler Pages deploy command using a validated configured project name; it does not accept arbitrary shell text or arguments from the browser.

- [ ] Build a local workflow to choose EPUB and cover, edit/review metadata, and preview the catalog listing.
- [ ] Show existing entries and prevent replacements; clearly identify the retained *The Unemployed Demon Lord*.
- [ ] Require a review and explicit confirmation before project files change.
- [ ] Reject non-loopback Host/Origin headers, validate content type and ID, stream under a body-size cap, and never interpolate user input into shell commands.
- [ ] Show build/deploy output in the UI; do not deploy if build fails; preserve the prior remote deployment and show recovery guidance after deployment failure.
- [ ] Provide preview and production actions; require a second confirmation for production.
- [ ] Add publisher build/start scripts and a dedicated Vite output directory so publisher assets never enter public `dist`.

## Task 4: Configure Cloudflare Pages and document operations

**Files:**
- Modify: `package.json`, `package-lock.json`, `README.md`
- Create: `public/_redirects` only if a verified non-hash route needs a fallback

- [ ] Pin Wrangler as a development dependency and add a fixed Pages Direct Upload script for Vite's `dist`.
- [ ] Read project name from ignored local config and show setup instructions if missing.
- [ ] Keep existing hash routes functional; add an SPA fallback only if the router uses a non-hash route that needs it.
- [ ] Document install/build/local preview, Wrangler login, project setup, preview deployment, production confirmation, file-size limit, and failed-deploy recovery.
- [ ] Run `npm run build` and inspect `dist` to ensure no publisher UI or credentials are included.

## Acceptance / verification

- The shared catalog contains no five named demos and preserves *The Unemployed Demon Lord* and all its assets.
- The local publisher rejects duplicate IDs and over-limit files, appends entries without replacing records, and builds the site.
- Publisher-only assets and local credentials do not appear in production output.
- A production deployment remains owner-triggered; do not deploy without explicit request and project setup.
