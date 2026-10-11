# Community Comments and Accounts — Progress

Last updated: 2026-10-09

## Goal

Implement the community-comments and optional-account feature described in the supplied
specification while preserving anonymous reading, local reading progress, EPUB downloads,
the existing reader, and the Cloudflare Pages deployment model.

## Current checkpoint

- [x] Read the supplied feature specification.
- [x] Inspect the repository structure, framework, routing, data model and reader lifecycle.
- [x] Confirm the frontend is TypeScript with Vite, static JSON content, hash routes and no
      existing account system.
- [x] Approve/execute the written design in `docs/superpowers/specs/2026-10-09-community-comments-design.md`.
- [x] Implement the feature in reviewable steps (database, services, UI, reader, moderation).
- [x] Add database migrations and setup/deployment documentation.
- [x] Run type-check, unit tests, production build and direct database authorization checks.
- [ ] Verify hosted Supabase auth email flows and RLS against a real Supabase project.
- [ ] Confirm browser rendering, mobile layout and sign-in on the deployed preview.

**Implementation status:** Implemented and locally verified. Hosted auth/email and
deployed-sign-in verification remain pending because no Supabase project or Cloudflare
account was available to this session. See "Remaining limitations".

## What was built

### Database (Supabase PostgreSQL + RLS)

- `supabase/migrations/20261009000100_community_core.sql`
  - `profiles` (unique normalized username, optional avatar path, timestamps) with an
    `auth.users` signup trigger that creates the profile and resolves username collisions.
  - `comments` with stable `novel_id`/`chapter_id` scope, `comment | review` kind, optional
    1–5 rating on top-level reviews only, one-level replies, and
    `visible | hidden | deleted` status.
  - `comment_likes` (unique `(comment_id, user_id)`), `comment_reports` (unique
    `(comment_id, reporter_id)`, private status/reviewer fields), `moderators`,
    `user_restrictions`, and private `community_rate_events`.
  - Triggers enforce: authorship on insert, immutable scope on update, reply scope/depth,
    one-level reply integrity, soft delete preserving reply ancestry, moderator-only
    visibility changes, and like/report validity.
  - `is_community_moderator()` / `is_user_restricted()` are `SECURITY DEFINER` with a fixed
    `search_path`.
  - Owner-checked RPCs: `delete_own_comment`, `set_comment_visibility`,
    `set_user_restriction`.
  - Server-enforced limits: 1 comment/10 s, 30 comments/24 h, 5 reports/24 h, plus an active
    restriction check.
  - RLS on every table with least-privilege grants (moderator and rate-limit tables are not
    readable or writable by clients at all).
- `supabase/migrations/20261009000200_community_avatars.sql` — public `avatars` bucket,
  2 MiB and PNG/JPEG/WebP limits, owner-only writes under `<auth.uid()>/`.
- No service-role key or privileged secret is present anywhere in the frontend.

### Frontend

- `src/community/` — optional lazy Supabase client, auth, profiles and the comment data
  service, plus a small event bus.
- `src/components/` — `AuthDialog` (sign-in/up/verify/reset/recovery/profile),
  `AccountMenu`, `CommentComposer`, `CommentThread`, `DiscussionPanel`,
  `ChapterDiscussion` (reader host).
- `src/pages/CommunityAdminPage.ts` — moderator queue.
- Integration in `src/main.ts`, `Navbar.ts`, `NovelPage.ts`, `Reader.ts`, `ReaderPage.ts`.
- `src/styles/community.css` — themed with existing tokens for all themes, responsive,
  reduced-motion aware, visible focus states.

## Files changed (new unless marked)

- `.env.example`
- `supabase/config.toml`, `supabase/templates/*.html`
- `supabase/migrations/20261009000100_community_core.sql`
- `supabase/migrations/20261009000200_community_avatars.sql`
- `supabase/tests/community_rls.test.sql`
- `tools/community-db-verify.mjs`
- `vitest.config.ts`
- `src/community/types.ts`, `events.ts`, `supabase.ts`, `auth.ts`, `profiles.ts`, `comments.ts`, `index.ts`
- `src/community/scope.test.ts`, `auth.test.ts`, `supabase.test.ts`, `comments-service.test.ts`
- `src/components/AuthDialog.ts`, `AccountMenu.ts`, `CommentComposer.ts`, `CommentThread.ts`,
  `DiscussionPanel.ts`, `ChapterDiscussion.ts`, `community-shared.ts`
- `src/components/DiscussionPanel.test.ts`, `ChapterDiscussion.test.ts`
- `src/pages/CommunityAdminPage.ts`
- `src/styles/community.css`
- `src/utils/time.ts`
- Modified: `package.json`, `package-lock.json`, `README.md`, `src/main.ts`, `src/style.css`
  (unchanged), `src/components/index.ts`, `src/components/Navbar.ts`, `src/components/Reader.ts`,
  `src/pages/NovelPage.ts`, `src/pages/ReaderPage.ts`, `progress.md`, `stop.md`

## Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Type check + production build | `npm run build` | Pass (`tsc` clean, Vite built `dist/`) |
| Frontend unit tests | `npm run test` | Pass — 6 files, 35 tests |
| Direct DB authorization | `npm run db:verify` | Pass — 62 checks, 0 failed |
| pgTAP suite authored | `supabase test db` | Not run — requires Supabase CLI + Docker (unavailable) |

`npm run db:verify` boots PostgreSQL 18 (PGlite/WASM), recreates minimal `auth`/`storage`
schemas, applies the actual migration files, and exercises RLS as `anon`, author, other
user and moderator. It covers: anonymous visibility, insert/impersonation rejection,
owner-only edit/delete, cross-thread and deep replies, duplicate likes/reports, private
reports, rate limits, moderation hide/restore, moderator body-edit rejection, self-grant
rejection, restrictions, review constraints, and avatar storage policies.

Reviewing the reader integration also caught and fixed a real lifecycle bug: rebuilding
the reader's chapter window cleared the DOM without disposing discussion regions, which
blocked re-mounting. `loadInitialChapters()` now disposes discussions first, with a
regression test covering re-mounting after a full dispose.

## Security findings

- Authorization is enforced in the database; the UI is usability only.
- `moderators` and `community_rate_events` have RLS enabled with no policies and all
  privileges revoked from `anon`/`authenticated`.
- Comment text is always inserted with `textContent`; a regression test asserts that a
  comment body containing HTML is rendered as inert text.
- Missing/blank Supabase variables or a failed SDK load never block reading.

## Remaining limitations / unverified

- No Supabase project was available, so **hosted** signup, email verification, password
  recovery email links, avatar uploads, and two-account production RLS were not exercised
  end-to-end. `supabase test db` (pgTAP) could not run without Docker.
- The pgTAP file is authored against Supabase's `auth.users` shape; it should be run once
  against a real project.
- Browser/mobile rendering and the deployed preview sign-in were not verified from this
  environment (no browser automation). The dev server was started and served HTTP 200 for
  the app shell, `main.ts`, and `data/novels.json`.

## Next action

Configure a Supabase project, run `supabase db push` and `supabase test db`, then verify
signup → email → login → comment in a browser, and confirm mobile/desktop layouts.

---

# Extension — Reader controls, ratings, public profiles, OAuth

Last updated: 2026-10-10

## Goal

Add four reader/community capabilities on top of the existing community layer
without changing the static deployment model or requiring an account to read.

## What was added

### 1. Custom reader controls (`src/components/Reader.ts`, `src/models/Novel.ts`,
`src/storage/index.ts`, `src/styles/components.css`)
- New per-reader settings: text alignment (left/justified), paragraph spacing,
  letter spacing, and a monospace font option, alongside the existing size,
  line-height, width, margin and font-family controls.
- A **Reset reading style** button restores the typography defaults without
  touching the reader theme or chapter-loading mode.
- Applied through CSS custom properties (`--reader-paragraph-spacing`) and inline
  styles, so they compose with every theme. Old saved settings merge with new
  defaults via `loadUserSettings`.

### 2. Ratings and review aggregation
- `supabase/migrations/20261009000300_community_ratings_profiles.sql` adds
  `security_invoker` views `novel_rating_summary` and `novel_rating_distribution`.
  Because they are `security_invoker`, RLS applies as the *querying* role: anonymous
  visitors only ever aggregate visible novel-level reviews.
- `src/community/ratings.ts` batches and caches reads so a library grid makes one
  request, never one per card.
- UI: novel header summary, library-card badge (`NovelCard`/`NovelGrid`), and a star
  distribution block at the top of the novel discussion panel.

### 3. Public profiles with comments and upvotes
- `profile_activity_summary` view exposes visible comment/review counts and upvotes
  received per author (hidden/deleted content never counts).
- `src/community/profiles.ts`: `getProfileByUsername`, `getProfileStats`.
- `src/community/comments.ts`: `listUserComments` (public, paginated).
- `src/pages/UserProfilePage.ts` + route `#user/<username>`: avatar, join date,
  activity counts and the reader's public comments with their upvotes, each linking
  back to the novel discussion. Author names in threads and the account menu link here.
- Avatar upload already existed; profiles display the uploaded avatar publicly.

### 4. OAuth providers
- `src/community/auth.ts`: `getOAuthProviders` and `signInWithOAuth` (Google/GitHub).
- `AuthDialog` shows a "continue with …" row on sign-in and sign-up when providers are
  enabled. `mapAuthError` now also reads plain error-like objects from the SDK.
- The OAuth-friendly profile bootstrap (`handle_new_community_user`, recreated in the
  new migration) derives a username from the provider display name when a `username`
  claim is absent, then normalizes and de-duplicates it.

## Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Type check + production build | `npm run build` | Pass |
| Frontend unit tests | `npm run test` | Pass — 11 files, 58 tests |
| Direct DB authorization | `npm run db:verify` | Pass — 71 checks, 0 failed |
| pgTAP suite | `supabase test db` | Not run — needs Supabase CLI + Docker |

New tests: `src/community/ratings.test.ts`, `oauth.test.ts`, `profiles.test.ts`,
`src/components/NovelCard.test.ts`, `src/storage/settings.test.ts`. `db:verify` gained
rating-aggregation, profile-activity and OAuth-bootstrap checks; the pgTAP suite grew
from 25 to 31 assertions.

## Remaining limitations

- Same hosted gaps as before: no live Supabase project, so social sign-in, email flows,
  avatar upload and production RLS were not exercised end-to-end.
- Provider enablement is a Supabase dashboard step; the frontend cannot verify it.
- Browser/mobile rendering and deployed sign-in remain unverified from this environment.

---

# Extension — Comment edit history + reading shelves

Last updated: 2026-10-10

## What was added

### Comment edit history and the soft "edited" timestamp
- `supabase/migrations/20261009000400_comment_revisions.sql`: a `comment_revisions`
  table, an `after update` trigger that records the previous body whenever an author
  edits a comment, and RLS that lets only the author and moderators read history.
  Clients cannot insert/update/delete revisions.
- The existing relative "edited" marker in `CommentThread` became a toggle that lazily
  loads the history (each prior body with its timestamp, plus the current version).
  Non-authors simply see an empty history.
- **Bug fixed:** the author delete path (`delete_own_comment`) set both the status and
  the `'[deleted]'` body in one statement, which the write trigger rejected as an
  "edit that changes moderation status", so deleting your own comment failed. The
  trigger now handles status transitions before the body-edit branch. Covered by a new
  regression check in `db:verify` and the existing pgTAP `lives_ok`.

### Reading shelves (Want to read / Reading / Finished)
- `supabase/migrations/20261009000500_reading_shelves.sql`: owner-only
  `reading_shelves` with a `deleted` tombstone column and last-write-wins `updated_at`.
- Local-first storage: a new `shelves` IndexedDB store (schema v5),
  `src/storage/shelves.ts` (active rows + tombstones), and `src/utils/shelves.ts` for
  shared labels/validation.
- `src/community/shelves.ts`: `pushShelfChange` and `syncShelvesWithAccount`, a
  last-write-wins merge that also honours tombstones so a locally removed shelf is never
  resurrected. Failures are non-fatal; local data stays authoritative.
- UI: `ShelfPicker` on the novel page, a shelf badge on library cards, and a "Shelves"
  filter group in the library. Sync runs on the community auth event (including the
  initial session) from `src/main.ts`.

## Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Type check + production build | `npm run build` | Pass |
| Frontend unit tests | `npm run test` | Pass — 15 files, 73 tests |
| Direct DB authorization | `npm run db:verify` | Pass — 88 checks, 0 failed |
| pgTAP suite | `supabase test db` | Not run — needs Supabase CLI + Docker (now 41 assertions) |

New tests: `src/utils/shelves.test.ts`, `src/community/shelves.test.ts`,
`src/community/revisions.test.ts`, `src/components/CommentThread.test.ts`. `db:verify`
gained edit-history, shelf-authorization and soft-delete-regression checks; the pgTAP
plan grew from 31 to 41.

## Remaining limitations

- Hosted verification is still pending (no live Supabase project): shelf cross-device
  sync, edit-history visibility in the hosted database, and OAuth were not exercised
  end-to-end. `supabase test db` still needs the CLI + Docker.
- Shelf merge ordering trusts client-supplied `updatedAt`; clocks that are far apart
  between devices could pick the "wrong" winner, which is acceptable for shelves.

---

# Extension — offline reading, notifications, @mentions, progress and in-reader search

Last updated: 2026-10-10

## What was added

### Full offline reading
- `public/sw.js` gained a second, independent cache (`yomi-offline:v1`) for shared
  chapter JSON (`/data/chapters/*.json`, network-first) and covers (`/covers/*`,
  cache-first), plus a `postMessage` API: `{type:'yomi-cache-offline', urls}` to
  precache and `{type:'yomi-remove-offline', novelId}` to evict. Only same-origin
  chapter/cover paths under those prefixes are ever cached, and each response is
  size-checked. The offline cache survives app-shell version bumps because activation
  only prunes `yomi-shell:` caches.
- `src/lib/offline-sw.ts` bridges the page to the worker (MessageChannel with a
  timeout, safe no-op when no worker controls the page). `NovelPage`'s **Save for
  offline** / **Remove offline copy** now precache/evict the network-layer copies in
  addition to the existing IndexedDB snapshot.
- `src/lib/install-prompt.ts` + `src/components/InstallButton.ts`: capture
  `beforeinstallprompt` and show an **Install app** navbar button when available.
- Web Share Target: `public/manifest.webmanifest` registers a GET `share_target`;
  `src/lib/share-target.ts` parses and strips `?title/text/url` at boot, `src/main.ts`
  routes to `#admin`, and `AdminPage` renders a "Shared with Yomi" panel. Only
  `http(s)` links are ever treated as openable.

### Notifications and @mentions
- `supabase/migrations/20261009000600_community_notifications.sql`: a per-recipient
  `notifications` table (`reply | mention | like`), a unique
  `(user_id, comment_id, kind)` constraint, an `after insert` trigger on `comments`
  that fans out replies and parsed `@username` mentions, an `after insert/delete`
  trigger on `comment_likes` that adds/removes the upvote notification, and an
  `after update` trigger that prunes notifications when a comment is soft-deleted.
  RLS is recipient-only (select + `update (read_at)`); rows are never client-writable.
  `mark_all_notifications_read()` is an owner-checked RPC.
- `src/community/notifications.ts` — list (paged), unread count, mark one/mark all,
  and pure helpers (`notificationTargetPath`, `notificationPreview`, `mapNotificationRow`).
- `src/components/NotificationBell.ts` — navbar bell with unread badge and a lazy
  inbox panel; clicking an item marks it read and navigates to the novel or the exact
  chapter. Hidden entirely when the community is unconfigured or the reader is signed out.
- `src/community/mentions.ts` + `renderMentionBody` in `community-shared.ts`:
  comment bodies render `@username` as profile links built from DOM nodes (never
  innerHTML), matching the profile handle grammar.

### Progress polish
- `src/lib/progress-stats.ts` — pure helpers for whole-book percent (chapter index plus
  in-chapter fraction), remaining words/chapters, a words-per-minute time-to-finish
  estimate and duration formatting.
- Novel page: a progress summary (percent + "about N min left"). Library cards: the
  progress bar now shows whole-book percent with a `Ch. N · P%` label. Reader toolbar:
  a persistent percent bar updated on chapter change and throttled scroll.

### In-reader search
- `src/lib/reader-search.ts` — pure `stripHtml`, `findTextMatches`, `buildSnippet`,
  `searchChapters`, plus DOM helpers `highlightMatches` / `clearSearchHighlights` /
  `activateMatch` that only touch text nodes.
- `src/components/ReaderSearch.ts` — a search panel (toolbar button, `Ctrl`/`Cmd`+`F`,
  or `f`) with "This chapter" / "Whole book" scope, match counter, previous/next, and
  a results list that jumps to the matching chapter and highlights the match. `Reader`
  wires the host callbacks, refreshes the panel after a window rebuild, and disposes it.

### Styles
- `src/styles/community.css`: notification bell/panel/badge and `@mention` links.
- `src/styles/components.css`: reader toolbar progress, search panel and highlights,
  novel progress summary, install button, share-target panel, responsive + reduced-motion.

## Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Type check + production build | `npm run build` | Pass |
| Frontend unit tests | `npm run test` | Pass — 21 files, 112 tests |
| Direct DB authorization | `npm run db:verify` | Pass — 106 checks, 0 failed |
| pgTAP suite | `supabase test db` | Not run — needs Supabase CLI + Docker (now 54 assertions) |

New tests: `src/community/mentions.test.ts`, `src/community/notifications.test.ts`,
`src/lib/progress-stats.test.ts`, `src/lib/reader-search.test.ts`,
`src/lib/share-target.test.ts`, `src/components/community-shared.test.ts`. `db:verify`
gained a Notifications section (reply/mention/upvote fan-out, dedupe, self-event
suppression, recipient-only reads, forge rejection, mark-all-read scope, soft-delete
pruning), growing from 88 to 106 checks. The pgTAP plan grew from 41 to 54.

## Remaining limitations

- No live Supabase project: hosted notifications, mention fan-out against real
  profiles, and cross-device behaviour were not exercised end-to-end. Migration 006
  must be applied to the project (`supabase db push`).
- The install prompt and Web Share Target are browser/PWA behaviours that need a human
  pass on a real device; jsdom cannot produce `beforeinstallprompt` or a share intent.
- Service-worker offline caching is only registered in a production build over
  HTTP(S)/localhost; it is not active on the development server, so it was validated by
  code inspection, `node --check` and the production `dist/sw.js` rather than a live
  offline reload.
- `supabase test db` still requires the Supabase CLI + Docker.

## Extension session — mobile viewport + mobile features, and hard offline-reader tests

- Mobile viewport/meta: `viewport-fit=cover` + `interactive-widget=resizes-content`, iOS/Android
  web-app meta, per-theme `theme-color` (now synced on theme change, including `System`).
- New `src/styles/mobile.css`, loaded last: device safe-area insets (`env(safe-area-inset-*)`)
  applied to the navbar, reader toolbar/buttons, reader padding and footer; `100dvh` reader
  height; bottom-sheet treatment for the reader-settings, in-reader search and notification
  panels at <=768px with a grab handle and `overscroll-behavior: contain`; 44px touch targets,
  `touch-action: manipulation`, sticky-hover removal and reduced-motion handling; `overflow-x:
  clip` on `body` so a wide child cannot pan the page without breaking the sticky navbar.
- Mobile feature retention: the navbar **Install app** button now renders an icon plus a label so
  the smallest phones hide only the text instead of losing the affordance.
- Hard tests for the online/offline reader: `src/sw.test.ts` (15 tests) runs the real
  `public/sw.js` inside a simulated `ServiceWorkerGlobalScope` — install/precache of the shell and
  catalog, activation, offline navigations (root, hash deep link, uncached path), hashed-asset
  and catalog fallbacks, cross-origin/non-GET passthrough, the offline-download message
  (precache, path allow-list, partial count, eviction, unrelated messages) and retention of the
  offline cache across an app-shell version bump. `src/data/reader-offline.test.ts` (9 tests)
  covers online/offline precedence (network vs saved snapshot vs personal import, tampered
  snapshot rejection, no network access when local storage is unavailable).
- `src/mobile-viewport.test.ts` grew from 11 to 15 static contracts (safe areas, dvh, sheets,
  sheet scroll containment, grab handles, sticky-safe horizontal overflow, install icon/label).

## Verification performed (mobile session)

| Check | Command | Result |
| --- | --- | --- |
| Type check + production build | `npm run build` | Pass |
| Frontend unit tests | `npm run test` | Pass — 26 files, 167 tests |
| Direct DB authorization | `npm run db:verify` | Pass — 106 checks, 0 failed |
| Mutation check (tests actually bite) | temporary break of the offline fallbacks | 4 tests failed as expected, then restored and green |
| pgTAP suite | `supabase test db` | Not run — needs Supabase CLI + Docker (54 assertions) |

The mutation check flipped the saved-snapshot fallback in `src/data/index.ts` and the cached
app-shell navigation fallback in `public/sw.js`; `reader-offline.test.ts` and `sw.test.ts` failed
in 4 places, then passed again after restoring both files byte-for-byte.

## Remaining limitations (mobile session)

- Real-device behaviour still needs a human pass: notch/home-indicator insets, on-screen keyboard
  resizing, install prompt, share target and a genuine offline reload on a deployed HTTPS build.
  The service worker is not registered on the dev server, so SW behaviour is covered by the
  simulated-scope tests plus the production `dist/sw.js`, not a live offline reload.
- No browser automation is available in this environment, so visual sheet/drag behaviour and
  rotation were verified through CSS contracts rather than screenshots.
