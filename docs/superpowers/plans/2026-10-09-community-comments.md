# Community Comments and Optional Accounts Implementation Plan

> **For agentic workers:** Execute tasks in order. Update `progress.md` after each verified task. Use isolated, reviewable changes; never deploy production as part of implementation.

**Goal:** Add secure optional accounts, novel/chapter discussions, and owner moderation to Yomi Reader without requiring accounts for reading or moving book content off static hosting.

**Architecture:** The existing TypeScript/Vite client uses the official Supabase client with public URL/publishable key only. PostgreSQL schema constraints, RLS, and narrowly scoped database functions enforce user ownership, discussion integrity, rate limits, reports, and moderator authority. Discussion panels load on demand and are disposed with reader chapter elements.

**Tech Stack:** Existing TypeScript, Vite, vanilla DOM components and CSS design tokens; `@supabase/supabase-js`; Supabase Auth, PostgreSQL, Storage, SQL migrations, RLS, and pgTAP; Vitest + jsdom for frontend unit/component tests.

**Spec:** `docs/superpowers/specs/2026-10-09-community-comments-design.md`

## Global Constraints

- Public novels, chapters, downloads, imports, and reading progress remain available without an account.
- Keep static book files and local personal data outside Supabase.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may be exposed to browser code; never use a service-role key in the app.
- Enforce every authorization decision in PostgreSQL RLS/functions; frontend checks are usability only.
- Use stable `novelId` and `chapterId` values to associate discussions; never associate by title or array position.
- Render comments as text. Never inject comment bodies as HTML.
- Treat missing community configuration and Supabase outages as non-fatal to reader startup and reading.
- Do not deploy to Cloudflare or mutate a hosted Supabase project during local implementation.

---

## File map

- `supabase/config.toml`: local Supabase Auth and database test configuration.
- `supabase/migrations/20261009000100_community.sql`: profile, discussion, reaction, report, moderation, restriction, and rate-limit schema plus RLS and triggers.
- `supabase/tests/community_rls.test.sql`: database-level policy and integrity tests.
- `.env.example`: public frontend variable names with empty values only.
- `package.json`, `package-lock.json`: Supabase client and test scripts/dependencies.
- `src/community/supabase.ts`: optional initialized client and service availability.
- `src/community/auth.ts`: session, signup, login/logout, email verification, reset, and auth change APIs.
- `src/community/profiles.ts`: profile read/edit and avatar upload APIs.
- `src/community/comments.ts`: scoped pagination, create/edit/delete, replies, likes, reports, and counts.
- `src/community/types.ts`: DTOs and explicit discussion scopes.
- `src/main.ts`: initialize optional community services, account UI, auth-change refresh, and routes.
- `src/components/AuthDialog.ts`, `src/components/AccountMenu.ts`: accessible auth/profile entry UI.
- `src/components/CommentComposer.ts`, `src/components/CommentThread.ts`, `src/components/DiscussionPanel.ts`: reusable, text-safe discussion UI.
- `src/pages/NovelPage.ts`: add novel-scoped discussion section.
- `src/components/Reader.ts`: mount chapter discussions after text, add access/count control, dispose on unload.
- `src/pages/CommunityAdminPage.ts`: moderator queue and comment restriction/restore actions.
- `src/styles/community.css`, `src/style.css`: responsive themed community styles.
- `README.md`: Supabase setup, email URL setup, env vars, moderator bootstrap, local verification, and Cloudflare configuration.
- `progress.md`, `stop.md`: checkpoint and safe resume notes.

## Task 1: Supabase database foundation and authorization

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20261009000100_community.sql`
- Create: `supabase/tests/community_rls.test.sql`
- Modify: `progress.md`

**Interfaces:**
- Database scope columns: `novel_id text NOT NULL`, `chapter_id text NULL`; `chapter_id IS NULL` means novel thread.
- Parent relation: `parent_id uuid NULL REFERENCES public.comments(id) ON DELETE SET NULL`; a trigger validates parent novel/chapter scope and rejects hidden/deleted parents. Author delete is soft-delete, preserving reply ancestry; clients receive no hard-delete privilege.
- Auth identity: all user-owned rows use `auth.uid()` and policies compare row ownership with it.
- Moderator helper: `public.is_community_moderator()` returns boolean, is `STABLE SECURITY DEFINER`, fixes `search_path`, and reads only the protected moderator table.

1. Start a local Supabase stack using the documented Supabase CLI and create local config with email auth and pgTAP enabled. Confirm `supabase status` reports the local database and Auth services before writing migrations.
2. Add the profile table and trigger that creates a profile from validated signup metadata. Normalize usernames with lowercase/trim in the database, enforce `^[a-z0-9_]{3,24}$`, and enforce uniqueness on the normalized value.
3. Add comments with generated UUID, author, novel/chapter scope, `comment | review` kind, body constrained to 1–4000 characters, optional 1–5 rating, optional parent, timestamps, and `visible | hidden | deleted` status. Enforce that reviews are top-level novel posts with a rating and chapter comments/replies have no rating. Add a before-insert/update trigger to validate identifiers, parent scope, and allowed mutable fields; owner deletion soft-deletes and replaces the body with `[deleted]`, retaining replies and rejecting further replies. Revoke hard-delete from client roles.
4. Add likes with unique `(comment_id, user_id)`, reports with unique `(comment_id, reporter_id)` and private status/review fields, moderator membership, user restrictions, and private rate-limit state. Add indexes for `(novel_id, chapter_id, created_at, id)`, `parent_id`, likes by comment, and pending reports.
5. Create the public `avatars` storage bucket with 2 MiB size and PNG/JPEG/WebP MIME limits. Add storage RLS that permits public reads and authenticated insert/update/delete only under the caller's `<auth.uid()>/` folder. Store the object path in `profiles.avatar_path`, never a caller-chosen external URL.
6. Add RLS policies: public select only of visible comments and public profile fields; authenticated self-only comment insert/update/delete; self-only like insert/delete; self-only report insert/read; moderator-only moderation/report/restriction actions. Revoke direct client writes to moderator and rate-limit tables. Ensure `WITH CHECK` derives author/reporter/liker from `auth.uid()` rather than client-supplied IDs.
7. Add a database trigger that allows one comment/reply per user per 10 seconds and 30 per rolling 24 hours, and no more than 5 reports per rolling 24 hours. Reject attempts when a user has an active restriction. Keep the rate state private and avoid client-controlled timestamps.
8. Write pgTAP cases using `SET LOCAL ROLE anon` and authenticated JWT claim fixtures. Assert: anonymous can select visible but not hidden comments; unauthenticated insert fails; user A can create/edit/delete own comment; user B cannot impersonate A or modify A's comment; cross-thread replies fail; invalid review scope/rating fails; duplicate likes and reports fail; hidden/report/restriction/moderator tables and avatar paths are protected; moderator can hide and restore.
9. Run `supabase test db` and fix SQL/policy errors until it passes. Run `npm run build` to confirm SQL/config additions do not affect the reader build. Mark only this database task complete in `progress.md` after both commands succeed.

## Task 2: Optional Supabase client, sessions, profiles, and account UI

**Files:**
- Create: `src/community/types.ts`
- Create: `src/community/supabase.ts`
- Create: `src/community/auth.ts`
- Create: `src/community/profiles.ts`
- Create: `src/components/AuthDialog.ts`
- Create: `src/components/AccountMenu.ts`
- Create: `.env.example`
- Modify: `package.json`, `package-lock.json`, `src/main.ts`, `src/components/Navbar.ts`, `src/style.css`, `progress.md`

**Interfaces:**
- `getCommunityClient(): SupabaseClient | null`
- `getCommunityAvailability(): 'ready' | 'unconfigured'`
- `getCurrentUser(): Promise<User | null>`
- `signUp(email: string, password: string, username: string): Promise<void>`
- `signIn(email: string, password: string): Promise<void>`
- `signOut(): Promise<void>`
- `sendPasswordReset(email: string): Promise<void>`
- `updateProfile(patch: { username?: string; avatarPath?: string | null }): Promise<Profile>`

1. Add `@supabase/supabase-js`, `vitest`, and `jsdom` using the existing npm lockfile. Add `test` and `test:watch` scripts without changing existing scripts. Add `.env.example` with `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=` only.
2. Implement optional client initialization. Treat missing/blank public variables as `unconfigured`; do not instantiate a broken client, throw during boot, or log key values. Configure Supabase Auth session persistence and URL session detection.
3. Implement auth/profile service functions with typed errors/messages. Use Supabase Auth APIs for signup, email confirmation, login, logout and recovery. Never read or store passwords outside the current form submission.
4. Implement avatar upload to the `avatars` bucket under `<auth.uid()>/<random-id>.<ext>`. Accept PNG, JPEG, and WebP only, enforce 2 MiB before upload, replace prior own object only, and store the resulting storage path in `profiles.avatar_path`.
5. Render `AccountMenu` from the navbar. Signed-out users get Sign in/Create account; signed-in users see username/avatar, Edit profile, and Sign out. If unconfigured, show a disabled “Community unavailable” state without disturbing other navbar actions.
6. Implement `AuthDialog` with sign-in, registration, email-verification notice, and reset-password states. Validate username/email/password lengths before calls; display Supabase errors inline with `role="status"`/`aria-live`; label controls and trap/restore focus if modal behavior is used.
7. Subscribe once to auth state changes in `main.ts`; update the account menu, and unregister the subscription on app teardown if a teardown path is added. Ensure login token callback processing happens before hash routing interprets the URL.
8. Add unit tests for missing configuration, username form validation, and auth error mapping using Vitest/jsdom. Run `npm run test -- --run` and `npm run build`.

## Task 3: Comment data service and novel discussions

**Files:**
- Create: `src/community/comments.ts`
- Create: `src/components/CommentComposer.ts`
- Create: `src/components/CommentThread.ts`
- Create: `src/components/DiscussionPanel.ts`
- Modify: `src/pages/NovelPage.ts`, `src/styles/community.css`, `src/style.css`, `progress.md`
- Test: `src/community/comments.test.ts`, `src/components/DiscussionPanel.test.ts`

**Interfaces:**
- `type DiscussionScope = { novelId: string; chapterId: string | null }`
- `listComments(scope: DiscussionScope, order: 'newest' | 'oldest', cursor?: { createdAt: string; id: string }): Promise<CommentPage>` with page size 20.
- `getCommentCount(scope: DiscussionScope): Promise<number>`
- `createComment(scope: DiscussionScope, body: string, options: { kind: 'comment' | 'review'; rating?: number; parentId?: string }): Promise<Comment>`
- `editComment(commentId: string, body: string): Promise<Comment>`
- `deleteComment(commentId: string): Promise<void>` (calls the owner-checked soft-delete RPC)
- `toggleLike(commentId: string, liked: boolean): Promise<void>`
- `reportComment(commentId: string, reason: ReportReason, details?: string): Promise<void>`

1. Implement `DiscussionScope` validation so novel-level scope explicitly sends `chapter_id: null`; chapter-level requests always send both IDs. Validate body trim/length in the client for fast feedback while preserving database validation as authority.
2. Implement 20-row keyset pagination ordered by `(created_at, id)` in matching direction. Return root comments only in the first page; load replies for a single parent only when its thread expands. Cache in-flight calls by exact `novelId/chapterId/order/cursor` key and clear/refresh after mutations/auth changes.
3. Implement CommentComposer for root comments and replies. Novel-level root posts can be ordinary comments or reviews; reviews can set a 1–5 rating. Chapter posts and replies are comments without ratings. Signed-out submit opens the auth dialog; it must not submit a mutation. Render accepted content using `textContent`/text nodes only.
4. Implement CommentThread with author profile, avatar fallback, localized timestamp, reply count, like state/count, and only show edit/delete controls for the current author. Confirm delete; delete calls an owner-checked database function that preserves reply ancestry. Report action uses fixed reason options and a details field bounded to 500 characters.
5. Implement DiscussionPanel with newest/oldest sorting, Load more, loading/empty/error/offline states, stable ID deduplication, and a non-blocking unavailable state if Supabase is not configured.
6. Attach a “Discussion” section after the novel's metadata/actions and before its separate chapter/sidebar layout, not inside the description. Provide All/Reviews filters, newest/oldest sort, and rating display for review posts. Keep it paginated and collapsed or load-on-visible; do not fetch discussions for every library card.
7. Test scope serialization, cursor ordering, in-flight request reuse, deduplication, review validation, text-only body rendering, and anonymous action prompting. Run `npm run test -- --run` and `npm run build`.

## Task 4: Chapter discussion integration with infinite scroll

**Files:**
- Modify: `src/components/Reader.ts`, `src/styles/community.css`, `src/style.css`, `progress.md`
- Test: `src/components/Reader.discussions.test.ts`

**Interfaces:**
- Add `private chapterDiscussions = new Map<string, { root: HTMLElement; dispose: () => void }>()` keyed by stable chapter ID within the current reader instance.
- Add `private renderChapterDiscussion(chapter: Chapter, block: HTMLElement): void`.
- Add `private disposeChapterDiscussion(chapterId: string): void`.

1. Add an accessible “Comments” toolbar action that expands the discussion panel for the current chapter and displays a count when the service is available; hide/disable it cleanly when community config is absent.
2. Append each chapter's collapsed discussion region after `.chapter-block-footer`. Pass `{ novelId: chapter.novelId, chapterId: chapter.id }` explicitly; never derive scope from title or chapter index.
3. Mount at most one panel per chapter ID. If an existing block is reobserved or recreated, reuse/refetch the same keyed state rather than appending duplicate comment DOM.
4. On `removeChapter`, dispose the panel's subscriptions/listeners/observers, remove its map entry, and then remove the chapter block. `destroy()` disposes every remaining panel. Reopening/reloading should restore by data fetch scoped to IDs.
5. When a user opens a chapter discussion, retain the current reader chapter and scroll position; closing/returning scrolls to the same chapter without writing a fake reading-progress update.
6. Keep discussion loading independent from `Reader.load()`: a Supabase request failure must never reject reader initialization or pause chapter loading/progress saves.
7. Test initial chapter load, append/unload/reappend, duplicate mount prevention, scope isolation, disposal on `removeChapter()` and `destroy()`, and scroll/progress preservation. Run `npm run test -- --run` and `npm run build`.

## Task 5: Moderation workflow

**Files:**
- Create: `src/pages/CommunityAdminPage.ts`
- Modify: `src/main.ts`, `src/community/comments.ts`, `src/components/Navbar.ts`, `src/styles/community.css`, `README.md`, `progress.md`

**Interfaces:**
- `listPendingReports(cursor?: string): Promise<ReportPage>`
- `setCommentVisibility(commentId: string, visibility: 'visible' | 'hidden'): Promise<void>`
- `setUserRestriction(userId: string, active: boolean, reason: string): Promise<void>`

1. Add a hash route `community-admin` that renders only when `getCurrentUser()` succeeds and `is_community_moderator()` is confirmed through a database RPC. Otherwise render an access-denied state; do not infer admin from a username or client metadata.
2. Add paginated pending reports with private reason/details, target comment and safe author context. Restrict reports data access via RLS, not by hiding the admin link.
3. Add hide/restore and restrict/unrestrict actions with confirmation and required reason. Show mutation errors and refresh report/comment state after success.
4. Add the moderator bootstrap procedure to README: owner creates their account, obtains their Auth UUID in Supabase dashboard, and inserts that UUID into the protected table through the SQL editor. State that this cannot be performed from Yomi's public UI.
5. Test route denial for anonymous/non-moderator users and permitted actions for a seeded moderator; verify direct API access follows the same RLS restrictions. Run `npm run test -- --run`, `supabase test db`, and `npm run build`.

## Task 6: Setup, deployment guidance, and end-to-end verification

**Files:**
- Modify: `README.md`, `.env.example`, `progress.md`, `stop.md`
- Test: `supabase/tests/community_rls.test.sql` and frontend tests from prior tasks

1. Document creating a Supabase project, applying migrations, enabling email/password and email verification, setting site/redirect URLs for local and production hash routes, creating the avatars bucket/policies, and configuring `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in local development and Cloudflare Pages environment settings. Include no real values.
2. Document local commands: `npm ci`, copy `.env.example` to `.env.local`, `npm run dev`, `npm run test -- --run`, `supabase start`, `supabase test db`, `npm run build`, and `npm run preview`. Mark Supabase CLI/Docker as local verification prerequisites, not production app servers.
3. Execute direct RLS cases as `anon`, user A, user B, and moderator for comment read/create/update/delete, cross-thread replies, likes, duplicate reports, report visibility, hidden status, and restrictions.
4. With a test Supabase project configured, manually verify register, email verify, login, logout, password reset, profile edits, avatar upload, author edit/delete, replies, sort/pagination, likes, report, moderation, session expiry, and reload. If no test project is available, report these hosted checks unverified rather than claiming completion.
5. Verify the library, chapter reading, local progress, local imports, and EPUB downloads with the user signed out, with no Supabase env vars, and with Supabase unreachable. Review desktop/mobile in dark, light, OLED, and sepia themes. Verify browser console has no unhandled community errors.
6. Run `npm run test -- --run`, `supabase test db`, and `npm run build`; fix failures and record exact results in `progress.md`. Do not deploy to Cloudflare as part of this plan.

## Completion gate

The feature is complete only when migrations and direct RLS tests pass, frontend checks and production build pass, all existing anonymous reading/download/local-storage flows remain intact, and any hosted workflow that lacked a configured test project is explicitly listed as unverified. Record remaining deployment steps in README and update `stop.md` with no unresolved blocker or a precise remaining one.
