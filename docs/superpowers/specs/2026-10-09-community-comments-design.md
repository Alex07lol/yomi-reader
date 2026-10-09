# Community Comments and Optional Accounts — Design

**Status:** Architecture and written design approved by the user on 2026-10-09.

## Goal

Add secure novel-level and chapter-level community discussions to Yomi Reader, with optional Supabase accounts, while keeping anonymous reading, EPUB downloads, local imports, and local reading progress available without an account.

## Existing application constraints

- The public app is TypeScript/Vite, statically hosted on Cloudflare Pages, and uses hash routes.
- Novel and chapter content is shipped as static files. Chapters have stable IDs and are loaded into an infinite-scroll reader that mounts and unloads chapter elements.
- Local imports, settings, and progress use browser storage. Community data must remain separate and must never be mixed into chapter text or private local books.
- The reader currently has no account system and the package manifest has no Supabase client.
- A missing or unavailable Supabase configuration/service must not break library browsing, reading, downloads, or local progress.

## Architecture

Use the official Supabase JavaScript client from the static frontend with only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exposed to the browser. All authorization is enforced in PostgreSQL through RLS, constraints, and narrowly scoped database functions/triggers. Never ship a service-role key or other privileged secret to the frontend.

The frontend will have a small community data/service layer, independent auth/profile UI, and reusable discussion UI. Supabase is an optional community service: when variables are absent or the service is unavailable, community controls show a clear unavailable state while the existing reader continues normally.

Database-owned safeguards will enforce valid parent/child discussion associations and posting limits. Moderator powers will use a protected moderator authorization table and fixed-search-path security-definer helpers where policy evaluation requires them. Initial moderator assignment is performed manually by the project owner through the authenticated Supabase SQL editor using the owner's registered user UUID; ordinary users cannot insert or edit moderator records.

## Data model

Create migrations for:

- `profiles`: `auth.users.id` primary/foreign key, unique normalized username, optional avatar storage path, creation timestamp, and update timestamp. The app derives the public image URL from the storage path.
- `comments`: generated ID, author ID, stable novel ID, nullable stable chapter ID (null means novel discussion), `comment | review` kind, body, optional 1–5 rating for top-level novel reviews only, parent ID for replies, creation/update timestamps, and visibility/moderation state. Author deletion is a soft-delete that replaces the body with a neutral deleted marker while preserving the row and replies; ordinary clients cannot hard-delete rows or edit moderation state.
- `comment_likes`: comment ID, user ID, creation timestamp, unique `(comment_id, user_id)`.
- `comment_reports`: reporter ID, comment ID, reason/details, creation timestamp, review status and reviewer metadata. Reports are private to the reporter and authorized moderators.
- `moderators`: user ID and grant metadata, readable only through restricted policy/function paths and writable only by database administrators.
- `user_restrictions`: user ID, reason, start/end time, and moderator who applied it; clients cannot write this table.
- Private rate-limit state keyed by user/action, updated only by a database function/trigger; it is not directly readable or writable by clients.
- A public `avatars` Storage bucket for PNG/JPEG/WebP profile images. Authenticated users may write only to their own `<auth.uid()>/...` paths; image size is capped at 2 MiB.

Add indexes for novel/chapter thread ordering, parent lookup, likes, and moderation review. Enforce body/username lengths and normalized username uniqueness. A reply's parent must exist, be visible, and have the same novel and chapter scope; invalid cross-thread parent references must fail in the database. A review is a top-level novel post and may have an integer rating from 1 to 5; chapter posts and replies are comments without a rating. Author deletion replaces the body with `[deleted]`, retains the row and child replies, and prevents future replies to it. Since static chapter data is not mirrored into PostgreSQL, stable novel/chapter IDs are validated as bounded identifiers and associated directly with the submitted discussion record.

## Authorization and abuse controls

- Anonymous users may read only visible/approved comments and public profiles needed to render them.
- Authenticated users may create comments, likes, and reports only as themselves (`auth.uid()`), and may edit/delete only their own comments.
- Clients cannot set author IDs, moderation state, report review state, or moderator membership.
- A database-enforced per-user throttle limits new comments/replies to one every 10 seconds and 30 per rolling 24-hour period. A user may report a given comment once and submit no more than 5 reports per rolling 24-hour period. Unique constraints prevent duplicate likes. These limits are defaults that can be tuned by changing database policy/function configuration, never by client input.
- All user-authored text is rendered as text; links are not interpreted as HTML. Avatars use a public Supabase Storage bucket with authenticated owner-only upload/update/delete rules, image MIME/size constraints (2 MiB maximum), and public read; arbitrary remote HTML or SVG is never accepted.
- Moderator actions are allowed only when a protected database lookup confirms moderator membership. Moderators can review reports, hide/restore comments, and restrict abusive users; report details are not exposed to normal readers.
- Use RLS in addition to UI guards. Test policies with anonymous, author, other-user, and moderator identities through direct database/API access.

## Account experience

Add signup, login, logout, email verification, password reset, session persistence, and a compact account menu. Require a unique username at registration/profile setup, with database uniqueness and client-side feedback. Allow a signed-in user to edit their username and optional avatar image in Supabase Storage. Reading and all existing local features stay available while signed out. If Supabase environment variables are missing, hide/disable account actions with an informative, non-blocking explanation rather than causing startup failure.

## Discussion experience

- Novel details: add an independent Discussion section with newest/oldest sorting, paginated comments and reviews, replies, likes, report actions, and author edit/delete controls. Reviews may include a 1–5 rating and are filterable apart from ordinary comments.
- Reader: append a visually separate, collapsible discussion area after the chapter's text/footer, keyed by both `novelId` and stable `chapterId`. Show a comments control/count in the reader toolbar when practical.
- Load a thread only when its panel is opened, paginate replies, and deduplicate by comment ID. Track mounted discussion controllers by stable chapter ID; dispose observers/listeners when `Reader.removeChapter` unloads a chapter. Reopening a chapter must restore state by refetching or using a scoped cache without duplicating DOM or cross-thread data.
- Opening a discussion must preserve chapter URL, scroll position, and reading-progress behavior. Returning to reading focuses/restores the originating chapter.
- Keep comment data outside the chapter content HTML and sanitized-EPUB pipeline.
- Provide loading, empty, error/offline, unauthenticated sign-in prompt, and expired-session states. Never let a community failure reject reader initialization.

## UI and accessibility

Follow existing design tokens and theme variables across dark, midnight, light, OLED, sepia, and system themes. Reuse compact buttons/forms; provide keyboard navigation, labels, focus states, responsive layout, reduced-motion support, and confirmation before delete. User text is visibly separate from translated novel text. Report/moderation controls stay compact and do not create a social-dashboard appearance.

## Delivery phases

1. **Supabase foundation and accounts:** dependency/config, auth/session lifecycle, profile schema, account UI, missing-config behavior, and setup docs.
2. **Discussion core:** comment schema and policies, data layer, paginated novel discussions, reply/like/report actions, and author editing/deletion.
3. **Reader discussions:** chapter-scoped lazy discussions, toolbar access/count, infinite-scroll lifecycle cleanup, and scroll restoration.
4. **Moderation and release readiness:** moderator/restriction schema and UI, deployment/setup guide, policy verification, failure states, responsive review, full checks, and update progress notes.

Each phase must preserve a buildable app and may not be represented as complete until its own checks pass. Supabase project setup, email-provider settings, environment variables, and production Cloudflare settings are documented with names/placeholders only; no credentials are committed.

## Verification expectations

Run project type-check/build and any existing lint/tests, plus focused tests for comment scoping, pagination/deduplication, reader mounting/unloading, and failure isolation. Verify signup/verification/login/logout/password reset and account recovery when a Supabase test project is configured. Directly verify RLS as anonymous, owner, unrelated user, and moderator for read/create/update/delete/like/report/moderation operations. Verify reading and EPUB downloads still work logged out and with missing/offline Supabase config. Review mobile and desktop in existing themes. Do not claim hosted workflows or production configuration verified without access to the corresponding Supabase/Cloudflare project.

## Known external dependency

No Supabase project URL, publishable key, test project, or Cloudflare environment access has been provided. The application and SQL can be prepared locally with placeholder configuration, but hosted authentication/email behavior and production RLS verification require a configured Supabase project. The unrelated EPUB download UI build attempt previously hit a filesystem permission error creating `dist/covers`; that should be checked separately during build verification.

## Out of scope

- Moving novels, chapters, reader progress, imports, or EPUB files into Supabase.
- Requiring accounts to read or download books.
- A custom always-on application backend.
- Public display of private report details or privileged secrets.
