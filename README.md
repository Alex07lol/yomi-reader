# Yomi Reader

Yomi is a static light-novel reader. Its public catalog is published as files, with no application backend, reader accounts, or cloud sync.

## How books are stored

- Books you publish through the owner tool become public site files. Visitors can read and download their EPUBs and covers.
- A reader's own EPUB imports, covers, chapters, settings, and progress are kept in that browser's IndexedDB on that device. The personal import flow does not upload them or add them to the shared catalog.
- Browser storage is tied to the browser profile. Clearing site data, losing the device, or a browser removing storage can remove personal books. Export a backup before changing devices or clearing browser data.
- Yomi asks the browser for persistent storage when supported. This may reduce automatic cleanup, but the browser can deny the request and it cannot prevent you or device cleanup tools from clearing site data. Storage-use and quota figures are estimates, not guarantees.
- Yomi can be opened without a network once its app files and the content being read are available on the device. Browser/offline availability is not a backup; shared titles are available offline only when saved by the reader where that feature is available.

## Back up and restore your device library

Personal EPUB imports are stored in IndexedDB in the current browser profile. They are not sent to Yomi, included in the public catalog, or synchronized to another device. Browser storage is best-effort: persistent storage is a browser-controlled request, private browsing may discard data, and browser settings or device cleanup can remove it. Keep backups in a separate safe location, such as another drive or a file backup service you trust. A Yomi backup is a ZIP download; Yomi itself does not upload or keep a copy.

Open the **Add a book** page and use **Download backup** to save your personal books, their covers and chapters, Yomi settings, and reading positions. The archive does not contain the public catalog, offline copies of shared books, or service-worker caches. Keep the downloaded ZIP somewhere separate from the device. Repeat the download after important library changes.

To move your library, open Yomi on the destination device, go to **Add a book**, choose **Choose backup ZIP**, and review the preview before selecting **Restore backup**. Yomi checks the archive and its contents before changing local data. If the archive is unsupported, damaged, malformed, or cannot be restored, the restore is aborted and the IndexedDB transaction is rolled back rather than reporting a partial success.

Restoring adds personal books whose IDs are not already in the destination library. Existing books with matching IDs and their chapters are skipped; the preview lists those collisions. For reading positions, the newer saved position wins, while progress belonging to an existing local personal book is preserved. Settings included in the backup replace the current Yomi settings on that device. A restore does not delete other local books.

## Requirements

- Node.js 22.12 or newer and npm. Use a currently supported Node.js release.
- A Cloudflare account only if you plan to publish the shared site. Cloudflare credentials stay in Wrangler's local login state and are not part of the site build.

## Install and run the reader

From the project folder, install the locked dependencies and start Vite:

```powershell
npm ci
npm run dev
```

Create and preview the public production build locally:

```powershell
npm run build
npm run preview
```

The public output is `dist/`. The app uses hash routes (`#library`, novel details, and reader routes), so it does not need a Pages rewrite or fallback rule.

## Read offline

Offline app-shell support works on a deployed HTTPS site and on `localhost` (including the local production preview). A normal insecure HTTP host cannot register the service worker, so offline support will not be available there.

Open Yomi once while online and allow the page to finish loading. The service worker is registered in production builds and saves the app shell, icons, manifest, and shared catalog metadata in Cache Storage. The browser may take a moment to install it; if the first visit was interrupted, reload once while online. Later visits can reopen the app shell without a connection. The catalog cache is refreshed from the network when available and falls back to its last cached copy offline.

Shared book chapters and covers are not automatically added to the app-shell cache. While online, open a shared title and choose **Save for offline**. Yomi saves that title's chapter text, cover, and metadata in IndexedDB on that device; it then appears as available offline in the library. Choose **Remove offline copy** on the title page to remove that saved shared copy. The EPUB itself is not downloaded as part of this action. Personal EPUB imports already live in IndexedDB on the device and can be read offline after import.

Offline copies and personal imports are browser storage, not durable backups. Available space varies by browser and device; a browser or user can clear site data, and some browsers may evict stored data under storage pressure. Export and keep a separate backup of personal books before clearing data or changing devices. Yomi's service worker only manages its own `yomi-shell:` Cache Storage entries; it does not remove IndexedDB records. Service-worker caches can be refreshed or removed by the browser and must not be treated as a backup.

## Publish a shared book locally

The owner publishing panel is a separate local tool. It does not ship in the public reader build. Keep both terminals open while using its development mode.

Terminal 1 starts the loopback-only publishing service:

```powershell
npm run publisher:api
```

Terminal 2 serves the owner panel:

```powershell
npm run publisher:dev
```

Open `http://127.0.0.1:5173`. The panel runs on your computer and binds to loopback. It validates an EPUB and cover, previews the metadata, and appends the new title to the shared static catalog. It never receives a reader's local personal library.

For the built local panel instead, run:

```powershell
npm run publisher:build
npm run publisher:start
```

Then open `http://127.0.0.1:4173`. Stop the local service with Ctrl+C when finished. The staging directory is private, ignored by Git, and temporary; staged files expire and are cleared when the service restarts.

## Configure Cloudflare Pages Direct Upload

Wrangler is pinned in this project and installed locally. Log in from a project terminal:

```powershell
npx wrangler login
```

For a new Pages Direct Upload project, create it once and choose its production branch when prompted:

```powershell
npx wrangler pages project create
```

Use the same project name in the local owner panel configuration. Copy the non-secret example file to the ignored local config and edit the project name if needed:

```powershell
Copy-Item tools/publisher/publisher.config.example.json tools/publisher/publisher.config.json
```

`publisher.config.json` is excluded from version control. It contains only the Pages project name and optional preview branch; never put an API token or other credential in it. Wrangler handles authentication locally. Do not copy Wrangler login files into the repository or `dist/`.

## Preview and production deployments

Build and review the public site before uploading it:

```powershell
npm run build
```

The owner panel reads the validated local project configuration and offers separate preview and production actions. Preview uses the configured preview branch. Production asks for explicit confirmation before it runs.

For the sample project name `yomi-reader`, fixed command-line equivalents are available:

```powershell
npm run pages:deploy:preview
npm run pages:deploy:production
```

The preview command targets the `preview` branch. The production command targets the Pages production environment. Running the production command is an explicit deployment action. If your project has a different name or preview branch, use the owner panel, which reads and validates your ignored local configuration.

These commands upload the already-built `dist/` directory using Wrangler Pages Direct Upload. They do not build or modify the source. A successful deployment creates a new Pages deployment; a failed deployment does not replace the currently active production deployment. If a deployment fails, keep the current deployed version in service, review Wrangler's error, check that every public asset is below the Pages limit, rerun `npm run build`, then retry the preview before production. Wrangler also offers deployment history and rollback in the Cloudflare dashboard.

Cloudflare Pages currently limits a single site asset to 25 MiB. Direct Upload supports up to 20,000 files on the Free plan; the built app and every published cover, chapter file, and EPUB count toward the site. The publisher rejects an individual source asset that exceeds the size limit before publishing it.

## Local data and privacy

No backend is used. Publicly published titles are readable/downloadable by everyone. Reader imports and progress remain in that reader's local browser IndexedDB and are not sent to Yomi or Cloudflare. Browser storage can still be cleared by the reader or browser, so keep a separate backup of personal books.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Public reader development server |
| `npm run build` | Type-check and build the public reader to `dist/` |
| `npm run preview` | Preview the public production build locally |
| `npm run publisher:api` | Start the owner service on loopback |
| `npm run publisher:dev` | Run the separate owner panel in development |
| `npm run publisher:build` | Build the owner panel into its isolated local output directory |
| `npm run publisher:start` | Serve the built owner panel and local API |
| `npm run pages:deploy:preview` | Upload `dist/` to the sample Pages preview branch |
| `npm run pages:deploy:production` | Upload `dist/` to the sample Pages production environment |

## Browser support

Modern desktop and mobile browsers with CSS custom properties, IndexedDB, and JavaScript module support.
