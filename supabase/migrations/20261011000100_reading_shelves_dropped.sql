-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — reading shelves gain a "Dropped" option
-- ════════════════════════════════════════════════════════════════════
-- Readers can now park a book as Dropped, next to the existing Want to read,
-- Reading and Completed. "Completed" is the reader-facing label for the existing
-- `finished` id, so only the allowed set changes here — no rows are rewritten.

alter table public.reading_shelves
  drop constraint if exists reading_shelves_shelf_check;

alter table public.reading_shelves
  add constraint reading_shelves_shelf_check
  check (shelf in ('want', 'reading', 'finished', 'dropped'));

comment on constraint reading_shelves_shelf_check on public.reading_shelves is
  'Allowed shelves. The `finished` id is shown to readers as "Completed".';
