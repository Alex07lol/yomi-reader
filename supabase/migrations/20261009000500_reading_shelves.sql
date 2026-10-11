-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — Synced reading shelves
-- ════════════════════════════════════════════════════════════════════
-- Shelves (Want to read / Reading / Finished) live in the reader's browser by
-- default and need no account. This table is the optional per-account copy so a
-- signed-in reader keeps their shelves across devices. It is strictly owner-only:
-- no one but the account owner can read or change their rows.
--
-- Sync is a last-write-wins merge on `updated_at`. Removals are kept as
-- tombstones (`deleted = true`) so a shelf removed on one device is not
-- resurrected by another device that still has the older row.

create table if not exists public.reading_shelves (
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id text not null,
  shelf text not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, novel_id),
  constraint reading_shelves_shelf_check check (shelf in ('want', 'reading', 'finished')),
  constraint reading_shelves_novel_id_check check (
    char_length(novel_id) between 1 and 120 and novel_id ~ '^[A-Za-z0-9._-]+$'
  )
);

create index if not exists reading_shelves_user_idx
  on public.reading_shelves (user_id, updated_at desc);

comment on table public.reading_shelves is
  'Per-account reading shelves. Owner-only; the local IndexedDB copy remains authoritative when signed out.';

alter table public.reading_shelves enable row level security;

drop policy if exists reading_shelves_select_own on public.reading_shelves;
create policy reading_shelves_select_own on public.reading_shelves
  for select using (user_id = auth.uid());

drop policy if exists reading_shelves_insert_own on public.reading_shelves;
create policy reading_shelves_insert_own on public.reading_shelves
  for insert with check (user_id = auth.uid());

drop policy if exists reading_shelves_update_own on public.reading_shelves;
create policy reading_shelves_update_own on public.reading_shelves
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists reading_shelves_delete_own on public.reading_shelves;
create policy reading_shelves_delete_own on public.reading_shelves
  for delete using (user_id = auth.uid());

revoke all on public.reading_shelves from anon, authenticated;
grant select, insert, update, delete on public.reading_shelves to authenticated;
