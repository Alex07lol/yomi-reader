# Yomi Reader

Yomi is a static light-novel reader. Its public catalog is published as files and it runs with no always-on application backend. Reading, downloads and local progress never require an account. Optional community accounts and discussions use Supabase and are entirely additive: if they are unconfigured or unreachable, the reader behaves exactly as before.

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

While online, open a shared title and choose **Save for offline**. Yomi saves that title's chapter text, cover, and metadata in IndexedDB on that device, and also asks the service worker to keep the same chapter JSON and cover responses in a separate `yomi-offline:` Cache Storage area, so reopening the app while offline is served at the network layer too. The title then appears as available offline in the library. Choose **Remove offline copy** on the title page to remove both copies. The EPUB itself is not downloaded as part of this action. Personal EPUB imports already live in IndexedDB on the device and can be read offline after import.

When the browser supports it, the navbar offers an **Install app** button so Yomi can run as an installed PWA. The manifest also registers Yomi as a **Web Share Target**: sharing a link, title or text from another app opens Yomi's Add-book page (`#admin`) with the shared content shown, and only `http(s)` links are ever treated as openable. The offline cache is independent of the versioned app shell, so an app-shell update never drops a book you saved for offline.

Offline copies and personal imports are browser storage, not durable backups. Available space varies by browser and device; a browser or user can clear site data, and some browsers may evict stored data under storage pressure. Export and keep a separate backup of personal books before clearing data or changing devices. Yomi's service worker only manages its own `yomi-shell:` and `yomi-offline:` Cache Storage entries; it does not remove IndexedDB records. Service-worker caches can be refreshed or removed by the browser and must not be treated as a backup.

## Reading controls

The reader ships with a full set of typography controls (open **Aa** in the reader
toolbar): font size, line height, reading width, page margin, font family
(serif/sans/monospace), paragraph spacing, letter spacing and left/justified
alignment, plus the theme picker. **Reset reading style** restores the typography
defaults without changing your theme or chapter-loading mode. All of it is stored
locally with your other settings and never requires an account.

The toolbar also carries a **persistent whole-book progress indicator** (percent read
for the entire novel, not just the loaded scroll window), and a **search** button
(or `Ctrl`/`Cmd`+`F`, or `f`) opens the in-reader search panel. Search works on the
chapter you are reading or the whole book, highlights every match, and steps through
them with previous/next; whole-book results list each matching chapter with a snippet
and jump straight to that chapter. The index is built entirely in the browser from
chapter text you already loaded — there is no server call.

## On phones and tablets

The layout is viewport-aware rather than a shrunken desktop page:

- The document opts into `viewport-fit=cover` and `interactive-widget=resizes-content`, so
  content reaches the edges of notched screens and the on-screen keyboard resizes the
  layout instead of overlaying the input.
- Chrome respects the device safe areas (`env(safe-area-inset-*)`): the navbar, reader toolbar,
  toolbar buttons, page padding and footer all shift clear of a notch, camera cutout or home
  indicator. The reader uses `100dvh` so it stays correct while mobile browser chrome hides and
  reappears.
- On screens up to 768px wide, the floating reader-settings, in-reader search and notification
  panels become full-width bottom sheets with a grab handle and scroll containment (scrolling a
  sheet never scrolls the chapter behind it). The reader's floating toolbar buttons dock into a
  row above the chapter navigation bar.
- Touch devices get 44px minimum tap targets, `touch-action: manipulation` (no 300ms double-tap
  delay) and no sticky `:hover` effects that would otherwise linger after a tap.
- The navbar **Install app** button stays available on the smallest phones by collapsing to its
  icon, and the browser's status bar colour follows the selected theme (including **System**).

Everything above is CSS/meta-data only — no mobile-specific code path and no extra network work.

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

## Community accounts and comments (optional)

Yomi can host novel-level and chapter-level discussions with optional accounts. This
feature is **off unless you configure it**: with no Supabase variables the library,
reader, downloads and local progress behave exactly as before, and the account area
shows a small "Community unavailable" note.

What accounts change:

- **Never required:** reading, chapter navigation, downloads, offline copies, imports,
  reading progress, themes and settings.
- **Required only for:** posting, replying, liking and reporting comments, and syncing
  reading shelves across devices. Shelves and edit history visibility are separate:
  shelves work locally without an account, and edit history is readable by the author and
  moderators regardless of device.

All authorization is enforced in PostgreSQL through Row Level Security, constraints
and narrowly-scoped functions. The browser only ever receives the public Supabase URL
and publishable/anon key. A service-role key must never be placed in the frontend.

### Architecture

- `@supabase/supabase-js` is loaded lazily and only when both public variables exist.
- SQL lives in `supabase/migrations/`:
  - `20261009000100_community_core.sql` — profiles, comments, likes, reports,
    moderators, restrictions, private rate-limit state, RLS, triggers and RPCs.
  - `20261009000200_community_avatars.sql` — the public `avatars` Storage bucket and
    owner-only write policies.
  - `20261009000300_community_ratings_profiles.sql` — `security_invoker` views for
    novel rating aggregation and public profile activity, plus an OAuth-friendly
    profile bootstrap.
  - `20261009000400_comment_revisions.sql` — comment edit history, readable only by
    the comment's author and moderators.
  - `20261009000500_reading_shelves.sql` — the optional per-account copy of reading
    shelves (owner-only RLS, last-write-wins with tombstones).
  - `20261009000600_community_notifications.sql` — a per-recipient notification inbox
    for replies, @mentions and upvotes, written only by SECURITY DEFINER triggers, plus
    the owner-checked `mark_all_notifications_read` RPC.
- Discussions are keyed by the stable `novel_id` / `chapter_id` used by the static
  reader data, so they survive chapter title or ordering changes. A row with
  `chapter_id IS NULL` is a novel-level thread.
- Personal EPUB imports never join the shared discussion space.
- **Ratings and reviews** aggregate automatically: novel-level reviews with a 1–5
  rating feed an average, a review count and a star distribution shown on the novel
  page and discussion panel, plus a compact badge on library cards.
- **Public profiles** (`#user/<username>`) show a reader's avatar, join date, visible
  comment/review counts, upvotes received and their public comments, which link back
  to the discussion they belong to. Author names in threads link to the profile.
- **Social sign-in** (Google, GitHub) is available alongside email where configured.
- **Reading shelves** (Want to read / Reading / Finished) work with no account: they are
  stored in the reader's browser and filterable from the library. Signing in mirrors them
  to the account so they follow the reader across devices.
- **Comment edit history**: when a comment is edited the previous text is kept, and an
  "edited" marker reveals the history with its timestamps. History is private to the
  comment's author and moderators.
- **@mentions** in comment bodies (`@username`) render as links to that reader's public
  profile. Mentioning someone also creates a notification for them.
- **Notifications** appear as a bell in the navbar with an unread count. Replies, mentions
  and upvotes each produce one row per recipient; the recipient can read their own inbox and
  mark items (or everything) as read. Rows are created only by database triggers, so a
  client can never forge, read or delete someone else's notifications, and a soft-deleted
  comment's notifications are removed automatically.
- **Reading progress** shows a whole-book percentage and an estimated time to finish on the
  novel page, a percent-aware bar on library cards, and a persistent percent indicator in the
  reader toolbar — all computed locally from chapter word counts and your saved position.

### 1. Create the Supabase project

1. Create a project at supabase.com and wait for provisioning.
2. From **Project Settings → API**, note the **Project URL** and the
   **anon/publishable key**. Do not copy the service-role key into the frontend.

### 2. Apply the database migrations

With the Supabase CLI installed and logged in:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Alternatively, paste each file from `supabase/migrations/` into the SQL editor in
order.

### 3. Configure authentication and email

In **Authentication**:

- Enable the **Email** provider with **Confirm email** turned on.
- Under **URL Configuration**, set **Site URL** to your production site
  (for example `https://yomi-reader.pages.dev`) and add redirect URLs:
  - `https://<your-production-domain>/**`
  - `https://<your-preview-domain>.pages.dev/**`
  - `http://localhost:5173/**` (local development)
- Optionally customize the confirmation and recovery email templates. The links
  must redirect back to the app; the client detects both the implicit hash flow
  and `?token_hash=…&type=…` links.

Passwords are handled entirely by Supabase Auth. Yomi never stores plaintext
passwords or implements its own password system.

To offer **social sign-in** (optional), enable one or more providers under
**Authentication → Providers** (for example Google and GitHub) and paste each
provider's client id/secret into Supabase — never into the frontend. Supabase brokers
the whole flow and returns to the redirect URLs configured above. OAuth sign-ups get a
username derived from the provider profile (normalized and made unique by the database),
which the reader can change later in **Your profile**. Choose which buttons appear with
the optional `VITE_SUPABASE_OAUTH_PROVIDERS` variable.

### 4. Configure frontend environment variables

The app reads two public variables:

| Name | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `VITE_SUPABASE_OAUTH_PROVIDERS` | *Optional.* Comma-separated providers to show (`google`, `github`). Unset = both; empty = none. |

Local development:

```bash
cp .env.example .env.local
# then fill in the two values
```

Cloudflare Pages (**Settings → Environment variables**) — add the same two names for
both **Production** and **Preview**. Vite inlines `VITE_*` values at build time, so
redeploy after changing them. Never commit `.env.local`.

### 5. Make yourself a moderator

Moderator status is a database-granted role, not a username check:

1. Register your account in Yomi and confirm your email.
2. Find your user id in **Authentication → Users**.
3. In the SQL editor, run:

```sql
insert into public.moderators (user_id) values ('<your-auth-user-uuid>');
```

The `moderators` table has RLS with no client policies, so ordinary users can never
grant themselves moderator access. The moderation queue is reachable from the account
menu (or `#community-admin`) and every action is re-checked by the database.

### 6. Deployment on Cloudflare Pages

The app uses hash routes, so no SPA rewrite/fallback rule is needed.

```bash
npm ci
npm run build
npx wrangler pages deploy dist --project-name yomi-reader
```

Set the environment variables from step 4 in the Pages project first. The existing
`pages:deploy:preview` / `pages:deploy:production` scripts still work.

### 7. Verify database security directly

Two complementary suites ship with the project:

```bash
npm run db:verify     # real PostgreSQL (PGlite/WASM): applies the migrations and
                      # exercises RLS as anon, author, other user and moderator
supabase test db      # pgTAP suite in supabase/tests/community_rls.test.sql
```

`npm run db:verify` builds a minimal `auth`/`storage` schema around the real migration
files and checks authorization at the database layer, not through the UI. It requires
no Docker and no Supabase project. `supabase test db` requires the Supabase CLI and
Docker.

### 8. Abuse-prevention defaults

These are enforced in the database and can be tuned by editing the relevant
function/policy (never by client input):

- One comment/reply per user per 10 seconds; 30 per rolling 24 hours.
- One like per user per comment (unique constraint).
- One report per user per comment; 5 reports per rolling 24 hours.
- Comment bodies 1–4000 characters; report details up to 500 characters.
- Comment text is always rendered as text, never as HTML.
- Moderators can hide/restore comments and temporarily restrict an account.
- Comment edit history is stored server-side by a trigger and readable only by the
  comment's author and moderators; clients cannot write or forge it.
- Reading shelves are owner-only: no account can read or change another account's shelves.

### Local development and testing

```bash
npm ci
npm run test          # frontend unit tests (Vitest + jsdom)
npm run db:verify     # database authorization checks
npm run build         # type check + production build
npm run preview       # serve the production build locally
```

To run the Supabase stack locally instead, use `supabase start`, copy the local URL
and anon key into `.env.local`, and use `supabase test db` for pgTAP.
