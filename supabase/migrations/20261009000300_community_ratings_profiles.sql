-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — Rating aggregation, public profile activity and
-- OAuth-friendly profile bootstrap
-- ════════════════════════════════════════════════════════════════════
-- These additions are read-only projections over the existing community
-- tables. They keep every authorization rule intact: each view is declared
-- `security_invoker`, so Row Level Security is evaluated as the *querying*
-- role. Anonymous visitors therefore only ever aggregate visible comments.

-- ─────────────────────────────────────────────────────────────────────
-- Per-novel rating summary
-- ─────────────────────────────────────────────────────────────────────
-- A "rating" is the 1–5 value stored on a novel-level review. Replies and
-- chapter comments can never carry a rating (enforced by constraints), so
-- this projection cannot be polluted by them.

create or replace view public.novel_rating_summary
with (security_invoker = true)
as
select
  c.novel_id,
  round(avg(c.rating)::numeric, 2) as average_rating,
  count(*)::int as rating_count
from public.comments c
where c.kind = 'review'
  and c.rating is not null
  and c.parent_id is null
  and c.chapter_id is null
  and c.status = 'visible'
group by c.novel_id;

comment on view public.novel_rating_summary is
  'Average review rating and review count per novel. RLS is evaluated as the querying role.';

grant select on public.novel_rating_summary to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Per-novel rating distribution (how many 1★ … 5★)
-- ─────────────────────────────────────────────────────────────────────

create or replace view public.novel_rating_distribution
with (security_invoker = true)
as
select
  c.novel_id,
  c.rating as stars,
  count(*)::int as star_count
from public.comments c
where c.kind = 'review'
  and c.rating is not null
  and c.parent_id is null
  and c.chapter_id is null
  and c.status = 'visible'
group by c.novel_id, c.rating;

grant select on public.novel_rating_distribution to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Public profile activity summary
-- ─────────────────────────────────────────────────────────────────────
-- Counts only visible activity, so hidden/deleted content never inflates a
-- profile. "Upvotes received" is the number of likes on the user's visible
-- comments.

create or replace view public.profile_activity_summary
with (security_invoker = true)
as
select
  c.author_id as user_id,
  count(*) filter (where c.kind = 'comment' and c.chapter_id is not null)::int as chapter_comment_count,
  count(*) filter (where c.kind = 'comment' and c.chapter_id is null)::int as novel_comment_count,
  count(*) filter (where c.kind = 'review')::int as review_count,
  coalesce(sum(l.likes), 0)::int as likes_received
from public.comments c
left join (
  select comment_id, count(*) as likes
  from public.comment_likes
  group by comment_id
) l on l.comment_id = c.id
where c.status = 'visible'
group by c.author_id;

comment on view public.profile_activity_summary is
  'Visible comment/review counts and upvotes received per author.';

grant select on public.profile_activity_summary to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- OAuth-friendly profile bootstrap
-- ─────────────────────────────────────────────────────────────────────
-- Email signups still carry a `username` in their metadata. OAuth sign-ups
-- (Google, GitHub, …) do not, so fall back to a provider-supplied display
-- name before generating a placeholder. The result is always normalized and
-- forced to be unique, exactly as before.

create or replace function public.handle_new_community_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  candidate text;
  suffix integer := 0;
begin
  base := coalesce(
    meta ->> 'username',
    meta ->> 'preferred_username',
    meta ->> 'user_name',
    meta ->> 'full_name',
    meta ->> 'name',
    ''
  );
  base := regexp_replace(lower(base), '[^a-z0-9_]', '', 'g');
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
