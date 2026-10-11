-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — Community schema, authorization and abuse controls
-- ════════════════════════════════════════════════════════════════════
-- Everything a client can do with community data is authorized here:
-- constraints, triggers, narrowly-scoped SECURITY DEFINER helpers and
-- Row Level Security. The frontend never holds a privileged key.
--
-- Stable identifiers: `novel_id` / `chapter_id` are the same IDs used by
-- the static reader data. They are validated as bounded identifiers and
-- never rebuilt from titles or array positions, so discussions survive
-- edits to chapter titles or ordering.

-- ─────────────────────────────────────────────────────────────────────
-- Profiles
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_avatar_path_format check (
    avatar_path is null
    or (char_length(avatar_path) <= 300 and avatar_path !~ '[\r\n]' and avatar_path !~ '^(https?:|data:|//)')
  )
);

create unique index if not exists profiles_username_key on public.profiles (username);

comment on table public.profiles is 'Public reader profiles. One row per authenticated user.';

-- Normalize the username before storage. Uniqueness is then database-enforced.
create or replace function public.tg_profiles_normalize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.username := lower(btrim(new.username));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_normalize on public.profiles;
create trigger profiles_normalize
  before insert or update on public.profiles
  for each row execute function public.tg_profiles_normalize();

-- ─────────────────────────────────────────────────────────────────────
-- Comments / reviews / replies
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  novel_id text not null,
  chapter_id text,
  kind text not null default 'comment',
  body text not null,
  rating smallint,
  parent_id uuid,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_author_id_fkey foreign key (author_id)
    references public.profiles(id) on delete cascade,
  constraint comments_parent_id_fkey foreign key (parent_id)
    references public.comments(id) on delete set null,
  constraint comments_kind_check check (kind in ('comment', 'review')),
  constraint comments_status_check check (status in ('visible', 'hidden', 'deleted')),
  constraint comments_body_check check (char_length(body) between 1 and 4000),
  constraint comments_novel_id_check check (
    char_length(novel_id) between 1 and 120 and novel_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint comments_chapter_id_check check (
    chapter_id is null
    or (char_length(chapter_id) between 1 and 120 and chapter_id ~ '^[A-Za-z0-9._-]+$')
  ),
  constraint comments_rating_check check (rating is null or rating between 1 and 5),
  constraint comments_review_scope_check check (
    kind <> 'review' or (parent_id is null and chapter_id is null)
  ),
  constraint comments_rating_scope_check check (
    rating is null or (kind = 'review' and parent_id is null and chapter_id is null)
  ),
  constraint comments_reply_kind_check check (
    parent_id is null or (kind = 'comment' and rating is null)
  )
);

comment on table public.comments is
  'Novel and chapter discussions. chapter_id IS NULL means a novel-level thread.';

create index if not exists comments_thread_idx
  on public.comments (novel_id, chapter_id, status, created_at desc, id desc);
create index if not exists comments_parent_idx
  on public.comments (parent_id, created_at asc, id asc);
create index if not exists comments_author_idx
  on public.comments (author_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Likes
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_likes_user_idx on public.comment_likes (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Reports
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  constraint comment_reports_reason_check check (
    reason in ('spam', 'abuse', 'harassment', 'spoiler', 'off-topic', 'other')
  ),
  constraint comment_reports_details_check check (details is null or char_length(details) <= 500),
  constraint comment_reports_status_check check (status in ('pending', 'dismissed', 'actioned')),
  constraint comment_reports_unique_reporter unique (comment_id, reporter_id)
);

create index if not exists comment_reports_status_idx
  on public.comment_reports (status, created_at asc);

-- ─────────────────────────────────────────────────────────────────────
-- Moderation membership and user restrictions
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.moderators is
  'Owner-managed moderator list. Only database administrators may write it; clients can only read their own status through is_community_moderator().';

create table if not exists public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  constraint user_restrictions_reason_check check (char_length(reason) between 3 and 500)
);

create unique index if not exists user_restrictions_active_key
  on public.user_restrictions (user_id) where lifted_at is null;

-- ─────────────────────────────────────────────────────────────────────
-- Private rate-limit state
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.community_rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint community_rate_events_action_check check (action in ('comment', 'report'))
);

create index if not exists community_rate_events_lookup
  on public.community_rate_events (user_id, action, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Authorization helpers (SECURITY DEFINER, fixed search_path)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.is_community_moderator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

create or replace function public.is_user_restricted(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_restrictions r
    where r.user_id = coalesce(p_user_id, auth.uid())
      and r.lifted_at is null
      and (r.expires_at is null or r.expires_at > now())
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Profile bootstrap from Supabase Auth signup metadata
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_community_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
begin
  base := regexp_replace(lower(coalesce(new.raw_user_meta_data ->> 'username', '')), '[^a-z0-9_]', '', 'g');
  if char_length(base) < 3 then
    base := 'reader_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base := left(base, 24);

  candidate := base;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    suffix := suffix + 1;
    if suffix > 50 then
      candidate := 'reader_' || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
    candidate := left(base, 24 - (char_length(suffix::text) + 1)) || '_' || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (new.id, candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_community_user();

-- ─────────────────────────────────────────────────────────────────────
-- Comment write validation (before insert/update)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_comments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_rec public.comments%rowtype;
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if actor is null or new.author_id is distinct from actor then
      raise exception 'A comment must be created by its author.' using errcode = '42501';
    end if;

    new.status := 'visible';
    new.created_at := now();
    new.updated_at := now();

    if char_length(btrim(new.body)) = 0 then
      raise exception 'A comment cannot be empty.' using errcode = '23514';
    end if;

    if new.parent_id is not null then
      select * into parent_rec from public.comments where id = new.parent_id;
      if not found then
        raise exception 'The comment you replied to no longer exists.' using errcode = '23503';
      end if;
      if parent_rec.status <> 'visible' then
        raise exception 'You cannot reply to a hidden or deleted comment.' using errcode = '23514';
      end if;
      if parent_rec.parent_id is not null then
        raise exception 'Replies may only be one level deep.' using errcode = '23514';
      end if;
      if parent_rec.novel_id is distinct from new.novel_id
         or parent_rec.chapter_id is distinct from new.chapter_id then
        raise exception 'A reply must belong to the same discussion as its parent.' using errcode = '23514';
      end if;
      if new.kind <> 'comment' or new.rating is not null then
        raise exception 'A reply must be an unrated comment.' using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  -- UPDATE -------------------------------------------------------------
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if new.id <> old.id
     or new.author_id <> old.author_id
     or new.novel_id <> old.novel_id
     or new.chapter_id is distinct from old.chapter_id
     or new.kind <> old.kind
     or new.parent_id is distinct from old.parent_id
     or new.rating is distinct from old.rating
     or new.created_at <> old.created_at then
    raise exception 'Comment scope and authorship cannot be changed.' using errcode = '42501';
  end if;

  if old.status = 'deleted' then
    raise exception 'A deleted comment cannot be changed.' using errcode = '42501';
  end if;

  -- A status transition (soft delete, hide, restore) is handled before the edit
  -- branch so a caller may safely set the canonical '[deleted]' body in the same
  -- statement as the status change without it being mistaken for an edit.
  if new.status is distinct from old.status then
    if new.status = 'deleted' then
      if old.author_id is distinct from actor then
        raise exception 'You can only delete your own comments.' using errcode = '42501';
      end if;
      new.body := '[deleted]';
    elsif new.status in ('visible', 'hidden') then
      if not public.is_community_moderator() then
        raise exception 'Only moderators may hide or restore comments.' using errcode = '42501';
      end if;
      if new.body is distinct from old.body then
        raise exception 'A moderator may not rewrite comment text.' using errcode = '42501';
      end if;
    else
      raise exception 'Unsupported moderation status.' using errcode = '23514';
    end if;

    new.updated_at := now();
    return new;
  end if;

  -- Body-only edit, always by the author.
  if new.body is distinct from old.body then
    if old.author_id is distinct from actor then
      raise exception 'You can only edit your own comments.' using errcode = '42501';
    end if;
    if old.status <> 'visible' then
      raise exception 'Hidden comments cannot be edited.' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comments_before_write on public.comments;
create trigger comments_before_write
  before insert or update on public.comments
  for each row execute function public.tg_comments_before_write();

-- ─────────────────────────────────────────────────────────────────────
-- Server-enforced posting limits
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_comments_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent integer;
  daily integer;
begin
  if public.is_user_restricted(new.author_id) then
    raise exception 'Your account is temporarily restricted from posting.' using errcode = '42501';
  end if;

  select count(*) into recent from public.community_rate_events
    where user_id = new.author_id and action = 'comment'
      and created_at > now() - interval '10 seconds';
  if recent > 0 then
    raise exception 'Please wait a few seconds before posting again.' using errcode = 'P0001';
  end if;

  select count(*) into daily from public.community_rate_events
    where user_id = new.author_id and action = 'comment'
      and created_at > now() - interval '24 hours';
  if daily >= 30 then
    raise exception 'You have reached the daily posting limit.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.tg_comments_record_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_rate_events (user_id, action) values (new.author_id, 'comment');
  return new;
end;
$$;

drop trigger if exists comments_rate_limit on public.comments;
create trigger comments_rate_limit
  before insert on public.comments
  for each row execute function public.tg_comments_rate_limit();

drop trigger if exists comments_record_rate on public.comments;
create trigger comments_record_rate
  after insert on public.comments
  for each row execute function public.tg_comments_record_rate();

-- ─────────────────────────────────────────────────────────────────────
-- Like and report validity, plus report rate limiting
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tg_likes_validate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.comments%rowtype;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'A like must belong to the authenticated user.' using errcode = '42501';
  end if;

  select * into target from public.comments where id = new.comment_id;
  if not found then
    raise exception 'Comment not found.' using errcode = '23503';
  end if;
  if target.status <> 'visible' then
    raise exception 'You can only like visible comments.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists likes_validate on public.comment_likes;
create trigger likes_validate
  before insert on public.comment_likes
  for each row execute function public.tg_likes_validate();

create or replace function public.tg_reports_validate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent integer;
  target public.comments%rowtype;
begin
  if auth.uid() is null or new.reporter_id is distinct from auth.uid() then
    raise exception 'A report must belong to the authenticated user.' using errcode = '42501';
  end if;

  new.status := 'pending';
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.created_at := now();

  if public.is_user_restricted(new.reporter_id) then
    raise exception 'Your account is temporarily restricted.' using errcode = '42501';
  end if;

  select * into target from public.comments where id = new.comment_id;
  if not found then
    raise exception 'Comment not found.' using errcode = '23503';
  end if;
  if target.author_id = new.reporter_id then
    raise exception 'You cannot report your own comment.' using errcode = '23514';
  end if;

  select count(*) into recent from public.community_rate_events
    where user_id = new.reporter_id and action = 'report'
      and created_at > now() - interval '24 hours';
  if recent >= 5 then
    raise exception 'You have reached the daily report limit.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.tg_reports_record_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_rate_events (user_id, action) values (new.reporter_id, 'report');
  return new;
end;
$$;

drop trigger if exists reports_validate on public.comment_reports;
create trigger reports_validate
  before insert on public.comment_reports
  for each row execute function public.tg_reports_validate();

drop trigger if exists reports_record_rate on public.comment_reports;
create trigger reports_record_rate
  after insert on public.comment_reports
  for each row execute function public.tg_reports_record_rate();

create or replace function public.tg_reports_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_community_moderator() then
    raise exception 'Only moderators may review reports.' using errcode = '42501';
  end if;
  if new.comment_id is distinct from old.comment_id
     or new.reporter_id is distinct from old.reporter_id
     or new.reason is distinct from old.reason
     or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at then
    raise exception 'Report content cannot be changed after submission.' using errcode = '42501';
  end if;
  new.reviewed_at := now();
  new.reviewed_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists reports_before_update on public.comment_reports;
create trigger reports_before_update
  before update on public.comment_reports
  for each row execute function public.tg_reports_before_update();

-- ─────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.comment_reports enable row level security;
alter table public.moderators enable row level security;
alter table public.user_restrictions enable row level security;
alter table public.community_rate_events enable row level security;

-- Profiles: public read; the owner may create and edit their own username/avatar.
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Comments: visible to everyone, own comments to their author, everything to moderators.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select using (
    status = 'visible' or author_id = auth.uid() or public.is_community_moderator()
  );

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments
  for insert with check (author_id = auth.uid());

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update using (author_id = auth.uid() and status = 'visible')
  with check (author_id = auth.uid());

drop policy if exists comments_update_moderator on public.comments;
create policy comments_update_moderator on public.comments
  for update using (public.is_community_moderator())
  with check (public.is_community_moderator());

-- Comment rows are never hard-deleted by clients; author deletion is a soft delete.

-- Likes: public counts; each user manages only their own like.
drop policy if exists likes_select_public on public.comment_likes;
create policy likes_select_public on public.comment_likes
  for select using (true);

drop policy if exists likes_insert_self on public.comment_likes;
create policy likes_insert_self on public.comment_likes
  for insert with check (user_id = auth.uid());

drop policy if exists likes_delete_self on public.comment_likes;
create policy likes_delete_self on public.comment_likes
  for delete using (user_id = auth.uid());

-- Reports: private to the reporter and to moderators.
drop policy if exists reports_select_own_or_moderator on public.comment_reports;
create policy reports_select_own_or_moderator on public.comment_reports
  for select using (reporter_id = auth.uid() or public.is_community_moderator());

drop policy if exists reports_insert_self on public.comment_reports;
create policy reports_insert_self on public.comment_reports
  for insert with check (reporter_id = auth.uid() and status = 'pending');

drop policy if exists reports_update_moderator on public.comment_reports;
create policy reports_update_moderator on public.comment_reports
  for update using (public.is_community_moderator())
  with check (public.is_community_moderator());

-- Moderators: no client policies. Read access is only through the helper function.
-- Restrictions: a user may see their own restriction; moderators manage them.
drop policy if exists restrictions_select_own_or_moderator on public.user_restrictions;
create policy restrictions_select_own_or_moderator on public.user_restrictions
  for select using (user_id = auth.uid() or public.is_community_moderator());

drop policy if exists restrictions_insert_moderator on public.user_restrictions;
create policy restrictions_insert_moderator on public.user_restrictions
  for insert with check (public.is_community_moderator() and created_by = auth.uid());

drop policy if exists restrictions_update_moderator on public.user_restrictions;
create policy restrictions_update_moderator on public.user_restrictions
  for update using (public.is_community_moderator())
  with check (public.is_community_moderator());

-- community_rate_events: no policies; only SECURITY DEFINER code touches it.

-- ─────────────────────────────────────────────────────────────────────
-- Least-privilege grants (Supabase default privileges are revoked first)
-- ─────────────────────────────────────────────────────────────────────

revoke all on public.profiles from anon, authenticated;
revoke all on public.comments from anon, authenticated;
revoke all on public.comment_likes from anon, authenticated;
revoke all on public.comment_reports from anon, authenticated;
revoke all on public.moderators from anon, authenticated;
revoke all on public.user_restrictions from anon, authenticated;
revoke all on public.community_rate_events from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant insert (id, username, avatar_path) on public.profiles to authenticated;
grant update (username, avatar_path) on public.profiles to authenticated;

grant select on public.comments to anon, authenticated;
grant insert, update on public.comments to authenticated;

grant select on public.comment_likes to anon, authenticated;
grant insert, delete on public.comment_likes to authenticated;

grant select, insert, update on public.comment_reports to authenticated;

grant select, insert, update on public.user_restrictions to authenticated;

revoke all on function public.is_community_moderator() from public;
revoke all on function public.is_user_restricted(uuid) from public;
grant execute on function public.is_community_moderator() to anon, authenticated;
grant execute on function public.is_user_restricted(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Owner-checked and moderator-checked RPCs used by the client
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.delete_own_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.comments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into target from public.comments where id = p_comment_id;
  if not found then
    raise exception 'Comment not found.' using errcode = 'P0002';
  end if;
  if target.author_id <> auth.uid() then
    raise exception 'You can only delete your own comments.' using errcode = '42501';
  end if;
  if target.status = 'deleted' then
    return;
  end if;

  update public.comments
    set status = 'deleted', body = '[deleted]'
    where id = p_comment_id;
end;
$$;

create or replace function public.set_comment_visibility(p_comment_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_community_moderator() then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;
  if p_visibility not in ('visible', 'hidden') then
    raise exception 'Unsupported visibility.' using errcode = '23514';
  end if;

  update public.comments
    set status = p_visibility
    where id = p_comment_id and status in ('visible', 'hidden');

  if not found then
    raise exception 'Comment not found or not moderatable.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_user_restriction(
  p_user_id uuid,
  p_active boolean,
  p_reason text,
  p_hours integer default 72
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not public.is_community_moderator() then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'A user is required.' using errcode = '23514';
  end if;
  if p_user_id = current_user_id then
    raise exception 'Moderators cannot restrict themselves.' using errcode = '23514';
  end if;

  if p_active then
    if p_reason is null or char_length(btrim(p_reason)) < 3 then
      raise exception 'A reason is required.' using errcode = '23514';
    end if;
    update public.user_restrictions
      set lifted_at = now()
      where user_id = p_user_id and lifted_at is null;

    insert into public.user_restrictions (user_id, reason, created_by, expires_at)
    values (
      p_user_id,
      btrim(p_reason),
      current_user_id,
      case when coalesce(p_hours, 0) > 0 then now() + make_interval(hours => p_hours) else null end
    );
  else
    update public.user_restrictions
      set lifted_at = now()
      where user_id = p_user_id and lifted_at is null;
  end if;
end;
$$;

revoke all on function public.delete_own_comment(uuid) from public;
revoke all on function public.set_comment_visibility(uuid, text) from public;
revoke all on function public.set_user_restriction(uuid, boolean, text, integer) from public;
grant execute on function public.delete_own_comment(uuid) to authenticated;
grant execute on function public.set_comment_visibility(uuid, text) to authenticated;
grant execute on function public.set_user_restriction(uuid, boolean, text, integer) to authenticated;
