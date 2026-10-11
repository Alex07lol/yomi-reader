# Stop and Resume Notes

This file is a handoff for safely pausing work on the community-comments and
optional-account feature. It is not a request to stop the application or remove any
existing functionality.

## If stopping now

- The community feature is implemented and locally verified; the working tree is clean
  apart from normal uncommitted work on the feature branch.
- Reading, downloads, imports and local progress remain anonymous and independent of
  Supabase. Do not make community configuration a requirement for them.
- No hosted Supabase project has been mutated and nothing has been deployed.
- Keep this file and `progress.md` with the project so the next session can resume.

## Resume procedure

1. Read `progress.md` and this file.
2. Inspect the current working tree and project guidance before editing.
3. Continue with the next unchecked action in `progress.md`.
4. Update `progress.md` after each meaningful and verified milestone.
5. Before calling the feature production-ready, verify authorization through database
   policies directly (not only through the UI) and confirm anonymous reading and
   downloads still work with community unconfigured.

## Stop conditions during implementation

Pause and record the blocker in `progress.md` if:

- A change would weaken authentication, RLS, moderator authorization, or private report
  data protections.
- A required Supabase or Cloudflare setting cannot be verified without real project access.
- A migration would destructively alter existing user or novel data.
- A build or security check fails and the cause is not understood.

Never add real Supabase credentials to source files, static assets, or these notes. Use
placeholders and environment-variable names only.

## Known blockers

- **Hosted verification pending.** No Supabase project or Cloudflare environment was
  available, so signup, email verification, password recovery, avatar upload and
  production RLS were not exercised end-to-end. `supabase test db` (pgTAP) requires the
  Supabase CLI and Docker, which are not installed here. Use `npm run db:verify` for the
  Docker-free local authorization suite in the meantime.
- **Previously reported build blocker is resolved.** The earlier `dist/covers` permission
  error did not reproduce: `npm run build` completed cleanly in this environment and wrote
  `dist/` (including `dist/assets/…` and an injected service-worker build id). Confirm the
  build directory is writable on any other machine before relying on it there.

## Current known state of the app

- `npm run build`, `npm run test` and `npm run db:verify` all pass in this environment.
- Frontend analytics: the Supabase client is code-split and only loaded when the two public
  variables are present.

## Extension session — reader controls, ratings, profiles, OAuth

- Four capabilities were layered on the community feature: custom reader typography
  controls (with reset), novel rating aggregation, public profiles with comments and
  upvotes, and optional Google/GitHub OAuth sign-in.
- Database additions are read-only `security_invoker` views plus a recreated
  OAuth-friendly profile trigger in
  `supabase/migrations/20261009000300_community_ratings_profiles.sql`. No existing
  table, policy or grant was weakened.
- `npm run build`, `npm run test` (58 tests) and `npm run db:verify` (71 checks) pass.
- Still outstanding before calling this production-ready: apply the new migration to a
  real Supabase project, enable the desired OAuth providers in the dashboard, and verify
  social sign-in, email flows, avatar upload and RLS against hosted services. `supabase
  test db` still needs the Supabase CLI + Docker.

## Extension session — comment edit history + reading shelves

- Comment edits now keep history server-side (`comment_revisions`, author/moderator
  read-only) and the "edited" marker reveals it. Reading shelves were added
  local-first with optional per-account sync (`reading_shelves`, owner-only RLS,
  last-write-wins with tombstones).
- Also fixed a real bug found while extending the write trigger: deleting your own
  comment failed because the delete RPC set status and body together, which the
  trigger rejected as a moderation-status change. The trigger now treats status
  transitions first; a regression check covers it.
- `npm run build`, `npm run test` (73 tests) and `npm run db:verify` (88 checks) pass.
- Outstanding: apply the two new migrations to a real project and verify hosted
  shelf sync and edit-history visibility; `supabase test db` still needs CLI + Docker.

## Extension session — offline reading, notifications, mentions, progress, in-reader search

- Five capabilities were added on top of the community layer: full offline reading
  (service-worker chapter/cover cache + install prompt + Web Share Target), a
  per-recipient notification inbox for replies/mentions/upvotes, `@mention` profile
  links, whole-book progress with a time-to-finish estimate, and in-reader search.
- Database addition: `supabase/migrations/20261009000600_community_notifications.sql`
  (`notifications` table, SECURITY DEFINER fan-out triggers, recipient-only RLS and the
  `mark_all_notifications_read` RPC). No existing table, policy or grant was weakened.
- `npm run build`, `npm run test` (112 tests) and `npm run db:verify` (106 checks) pass.
- Outstanding before calling this production-ready: apply migration 006 to a real
  Supabase project and verify hosted notifications; perform a human PWA pass for install
  and share target; and validate a real offline reload on a production build. `supabase
  test db` still needs the Supabase CLI + Docker.

## Extension session — mobile viewport + mobile features, and hard offline tests

- Meta/viewport: `viewport-fit=cover`, `interactive-widget=resizes-content`, iOS/Android web-app
  meta, and a `theme-color` that now follows the selected theme (including `System`).
- `src/styles/mobile.css` (loaded last) adds safe-area-aware chrome, `100dvh` reader height,
  bottom-sheet panels at <=768px with a grab handle and scroll containment, 44px touch targets,
  no sticky touch hover, and `overflow-x: clip` on `body` (chosen over `hidden` so the sticky
  navbar keeps working).
- The navbar install button keeps working on the smallest phones (icon-only label) rather than
  being hidden.
- Hard offline tests: `src/sw.test.ts` exercises the real `public/sw.js` in a simulated
  `ServiceWorkerGlobalScope` (shell precache, offline navigations and fallbacks, offline-download
  message handling, eviction, cache retention across a shell update) and
  `src/data/reader-offline.test.ts` covers network/saved-snapshot/personal-import precedence.
  A mutation check (breaking both offline fallbacks) failed 4 of these tests, confirming they
  bite; both files were restored unchanged.
- `npm run build`, `npm run test` (26 files, 169 tests) and `npm run db:verify` (106 checks) pass.
- Hosted Supabase is connected (`yrajxgfflhianlvrkkdc`, six migrations pushed) and checked
  with the publishable key: public tables answer 200 while `comment_revisions`,
  `notifications` and `reading_shelves` return 42501 for `anon`. Community config now flows
  through `src/community/env.ts` so the tests no longer depend on a local `.env.local`.
- Outstanding: a human pass on a real device (safe-area insets, keyboard resizing, install
  prompt, share target, true offline reload); no browser automation is available here.

