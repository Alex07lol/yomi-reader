-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — Community notifications
-- ════════════════════════════════════════════════════════════════════
-- A small, strictly per-recipient inbox for the events a reader cares about:
--   * `reply`   — someone replied to their comment
--   * `mention` — someone wrote @their-username
--   * `like`    — someone upvoted their comment
--
-- Rows are written exclusively by SECURITY DEFINER triggers on `comments` and
-- `comment_likes`, so a client can never fabricate, read or delete another
-- reader's notifications. The recipient may only read their own rows and mark
-- them as read. Notifications for a soft-deleted comment are removed so a
-- deleted thread does not keep pinging an inbox.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  comment_id uuid references public.comments(id) on delete cascade,
  novel_id text not null,
  chapter_id text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check check (kind in ('reply', 'mention', 'like')),
  constraint notifications_novel_id_check check (
    char_length(novel_id) between 1 and 120 and novel_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint notifications_chapter_id_check check (
    chapter_id is null
    or (char_length(chapter_id) between 1 and 120 and chapter_id ~ '^[A-Za-z0-9._-]+$')
  ),
  -- One row per recipient, per comment, per event type. Re-running a trigger
  -- (or an @mention that duplicates a reply) can never create duplicates.
  constraint notifications_unique_event unique (user_id, comment_id, kind)
);

create index if not exists notifications_inbox_idx
  on public.notifications (user_id, created_at desc, id desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

comment on table public.notifications is
  'Per-recipient community inbox. Written only by SECURITY DEFINER triggers; the recipient may read and mark their own rows as read.';

-- ─────────────────────────────────────────────────────────────────────
-- Reply + mention fan-out on new comments
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_author uuid;
  mentioned_id uuid;
  rec record;
begin
  -- Reply: notify the parent comment's author.
  if new.parent_id is not null then
    select c.author_id into parent_author from public.comments c where c.id = new.parent_id;
    if parent_author is not null and parent_author <> new.author_id then
      insert into public.notifications (user_id, actor_id, kind, comment_id, novel_id, chapter_id)
      values (parent_author, new.author_id, 'reply', new.id, new.novel_id, new.chapter_id)
      on conflict (user_id, comment_id, kind) do nothing;
    end if;
  end if;

  -- Mentions: `@username` tokens, resolved against the unique profile handle.
  for rec in
    select distinct lower(t.match[1]) as uname
    from regexp_matches(new.body, '@([A-Za-z0-9_]{3,24})', 'g') as t(match)
  loop
    select p.id into mentioned_id from public.profiles p where p.username = rec.uname;
    if mentioned_id is not null
       and mentioned_id <> new.author_id
       and mentioned_id is distinct from parent_author then
      insert into public.notifications (user_id, actor_id, kind, comment_id, novel_id, chapter_id)
      values (mentioned_id, new.author_id, 'mention', new.id, new.novel_id, new.chapter_id)
      on conflict (user_id, comment_id, kind) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.tg_comments_notify();

-- ─────────────────────────────────────────────────────────────────────
-- Like fan-out (and cleanup on unlike)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_likes_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.comments%rowtype;
begin
  select * into target from public.comments where id = new.comment_id;
  if not found or target.status <> 'visible' then
    return new;
  end if;
  if target.author_id = new.user_id then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, kind, comment_id, novel_id, chapter_id)
  values (target.author_id, new.user_id, 'like', target.id, target.novel_id, target.chapter_id)
  on conflict (user_id, comment_id, kind) do nothing;

  return new;
end;
$$;

drop trigger if exists likes_notify on public.comment_likes;
create trigger likes_notify
  after insert on public.comment_likes
  for each row execute function public.tg_likes_notify();

create or replace function public.tg_likes_unnofify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notifications
    where comment_id = old.comment_id and actor_id = old.user_id and kind = 'like';
  return old;
end;
$$;

drop trigger if exists likes_unnofify on public.comment_likes;
create trigger likes_unnofify
  after delete on public.comment_likes
  for each row execute function public.tg_likes_unnofify();

-- ─────────────────────────────────────────────────────────────────────
-- Drop a comment's notifications when it is soft-deleted
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_comments_prune_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    delete from public.notifications where comment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_prune_notifications on public.comments;
create trigger comments_prune_notifications
  after update on public.comments
  for each row execute function public.tg_comments_prune_notifications();

-- ─────────────────────────────────────────────────────────────────────
-- Row Level Security: recipient-only
-- ─────────────────────────────────────────────────────────────────────

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No client INSERT or DELETE: rows are created by SECURITY DEFINER triggers and
-- removed automatically (comment deleted) or by cascade.

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Trigger functions are never callable by clients.
revoke all on function public.tg_comments_notify() from public;
revoke all on function public.tg_likes_notify() from public;
revoke all on function public.tg_likes_unnofify() from public;
revoke all on function public.tg_comments_prune_notifications() from public;

-- ─────────────────────────────────────────────────────────────────────
-- Owner-checked helpers used by the client
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.notifications
    set read_at = now()
    where user_id = auth.uid() and read_at is null;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;
