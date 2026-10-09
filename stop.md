# Stop and Resume Notes

This file is a handoff for safely pausing work on the community-comments and optional-account feature. It is not a request to stop the application or remove any existing functionality.

## If stopping now

- No community feature implementation has started; there are no partially applied Supabase migrations to roll back from this checkpoint.
- Preserve all existing Yomi Reader files and local reading data.
- Do not deploy changes or publish credentials as part of a pause.
- Keep this file and `progress.md` with the project so the next session can resume from the recorded checkpoint.

## Resume procedure

1. Read `progress.md` and this file.
2. Inspect the current working tree and project guidance before editing; later work may have changed the repository.
3. Continue with the next unchecked action in `progress.md`.
4. Before implementation, complete the approved design and implementation-plan handoffs for this architectural change.
5. Update `progress.md` after each meaningful and verified milestone.
6. Before calling the feature production-ready, verify authorization through database policies directly, not only through the UI, and confirm anonymous reading and downloads still work.

## Stop conditions during implementation

Pause feature work and record the blocker in `progress.md` if:

- A design decision would weaken authentication, RLS, moderator authorization, or private report data protections.
- A required Supabase or Cloudflare setting cannot be verified without real project access.
- A migration would destructively alter existing user or novel data.
- The app's reader lifecycle differs from assumptions in the plan, especially for infinite scroll, chapter identity, or scroll restoration.
- A build or security check fails and the cause is not understood.

Never add real Supabase credentials to source files, static assets, or these notes. Use placeholders for environment-variable names and configuration examples.

## Current known blocker

The separate EPUB-download change's production build attempt was blocked when Vite could not create `dist/covers` due to a filesystem permission error. Confirm the build output directory is writable before relying on a new production build; do not delete build output or change deployment permissions blindly.
