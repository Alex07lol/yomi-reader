-- ════════════════════════════════════════════════════════════════════
-- pgTAP coverage for community schema authorization
-- Run with: supabase test db   (requires the Supabase CLI + Docker)
-- ════════════════════════════════════════════════════════════════════

begin;

create extension if not exists pgtap with schema extensions;

select plan(54);

-- ── Fixtures ────────────────────────────────────────────────────────
-- Deterministic identities used by the whole suite.
-- A = author, B = unrelated reader, M = moderator.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', crypt('password-a', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"username":"Alice_Writer"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', crypt('password-b', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"username":"Bob"}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@example.test', crypt('password-m', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"username":"Mod"}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'oauth@example.test', crypt('password-o', gen_salt('bf')), now(), '{"provider":"google","providers":["google"]}', '{"name":"Jordan Lee"}', now(), now());

insert into public.moderators (user_id) values ('33333333-3333-4333-8333-333333333333');

-- Grant the pgTAP session the ability to impersonate a role and claims.
create or replace function tests_act_as(p_role text, p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.role', p_role, true);
end;
$$;

-- Posting limits are per-user and time based; the suite resets them between
-- authors exactly as the frontend meets them in real use.
create or replace function tests_reset_rate_limits()
returns void language plpgsql security definer as $$
begin
  delete from public.community_rate_events;
end;
$$;

-- The auth trigger created the profiles.
select is(
  (select username from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'alice_writer',
  'signup trigger creates a normalized profile'
);

select is(
  (select username from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  'jordanlee',
  'OAuth signups derive a username from the provider display name'
);

-- ── Anonymous reads only visible comments ───────────────────────────
insert into public.comments (author_id, novel_id, chapter_id, kind, body, status)
values
  ('11111111-1111-4111-8111-111111111111', 'novel-1', 'chapter-1', 'comment', 'visible one', 'visible'),
  ('11111111-1111-4111-8111-111111111111', 'novel-1', 'chapter-1', 'comment', 'hidden one', 'hidden');

select tests_act_as('anon', null);
select is(
  (select count(*)::int from public.comments where novel_id = 'novel-1' and chapter_id = 'chapter-1'),
  1,
  'anonymous sees only visible comments'
);

-- ── Anonymous cannot post ───────────────────────────────────────────
select throws_ok(
  $$ insert into public.comments (author_id, novel_id, body) values ('11111111-1111-4111-8111-111111111111', 'novel-1', 'nope') $$,
  '42501',
  null,
  'anonymous cannot insert a comment'
);

-- ── Authenticated author can post ──────────────────────────────────
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
insert into public.comments (id, author_id, novel_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'novel-2', 'my comment');

select is(
  (select body from public.comments where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'my comment',
  'author can create a comment'
);

-- ── Cannot impersonate another author ──────────────────────────────
select throws_ok(
  $$ insert into public.comments (author_id, novel_id, body) values ('22222222-2222-4222-8222-222222222222', 'novel-2', 'impersonate') $$,
  '42501',
  null,
  'author cannot post as another user'
);

-- ── Author edits own comment ───────────────────────────────────────
update public.comments set body = 'edited' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select body from public.comments where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'edited',
  'author can edit their own comment'
);

-- ── Other user cannot edit it ──────────────────────────────────────
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
update public.comments set body = 'hijacked' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select body from public.comments where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'edited',
  'another user cannot edit a comment they do not own'
);

-- ── Other user cannot soft-delete through the RPC ──────────────────
select throws_ok(
  $$ select public.delete_own_comment('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'another user cannot delete a comment they do not own'
);

-- ── Owner soft-deletes through the RPC ─────────────────────────────
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.delete_own_comment('aaaaaaaa-0000-4000-8000-000000000001') $$,
  'owner can delete their own comment'
);
select is(
  (select status from public.comments where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'deleted',
  'author delete is a soft delete'
);

-- ── Replies must share discussion scope ────────────────────────────
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ insert into public.comments (author_id, novel_id, chapter_id, parent_id, body)
     values ('22222222-2222-4222-8222-222222222222', 'novel-2', 'chapter-9', '22222222-0000-4000-8000-000000000009', 'cross thread') $$,
  null,
  null,
  'a reply with a missing parent is rejected'
);

select throws_ok(
  $$ insert into public.comments (author_id, novel_id, chapter_id, parent_id, body)
     values ('22222222-2222-4222-8222-222222222222', 'novel-1', 'chapter-1', 'aaaaaaaa-0000-4000-8000-000000000001', 'reply to deleted') $$,
  '23514',
  null,
  'a reply to a deleted comment is rejected'
);

-- ── Duplicate likes are impossible ─────────────────────────────────
insert into public.comments (id, author_id, novel_id, chapter_id, body)
values ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'novel-1', 'chapter-1', 'like target');

insert into public.comment_likes (comment_id, user_id)
values ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ insert into public.comment_likes (comment_id, user_id)
     values ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222') $$,
  '23505',
  null,
  'a user cannot like the same comment twice'
);

-- ── Reports are private ────────────────────────────────────────────
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
insert into public.comment_reports (comment_id, reporter_id, reason)
values ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'spam');

select throws_ok(
  $$ insert into public.comment_reports (comment_id, reporter_id, reason)
     values ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'spam') $$,
  '23505',
  null,
  'a user cannot report the same comment twice'
);

select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.comment_reports),
  0,
  'an unrelated user cannot read someone else''s report'
);

-- ── Moderator authority ────────────────────────────────────────────
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.set_comment_visibility('bbbbbbbb-0000-4000-8000-000000000002', 'hidden') $$,
  '42501',
  null,
  'a normal user cannot hide comments'
);
select throws_ok(
  $$ insert into public.moderators (user_id) values ('11111111-1111-4111-8111-111111111111') $$,
  '42501',
  null,
  'a user cannot grant themselves moderator access'
);

select tests_act_as('authenticated', '33333333-3333-4333-8333-333333333333');
select ok(
  (select public.is_community_moderator()),
  'a moderator is recognized'
);
select lives_ok(
  $$ select public.set_comment_visibility('bbbbbbbb-0000-4000-8000-000000000002', 'hidden') $$,
  'a moderator can hide a comment'
);
select is(
  (select status from public.comments where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'hidden',
  'hidden status is stored'
);
select is(
  (select count(*)::int from public.comment_reports),
  1,
  'a moderator can read all reports'
);

-- ── Restrictions ───────────────────────────────────────────────────
select lives_ok(
  $$ select public.set_user_restriction('22222222-2222-4222-8222-222222222222', true, 'spam', 24) $$,
  'a moderator can restrict a user'
);
select ok(
  (select public.is_user_restricted('22222222-2222-4222-8222-222222222222')),
  'the restriction is active'
);
select throws_ok(
  $$ select public.set_user_restriction('33333333-3333-4333-8333-333333333333', true, 'self', 24) $$,
  '23514',
  null,
  'a moderator cannot restrict themselves'
);

-- ── Hidden rows stay invisible to anonymous readers ────────────────
select tests_act_as('anon', null);
select is(
  (select count(*)::int from public.comments where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'hidden comments are invisible to anonymous readers'
);

-- ── Rating aggregation respects visibility ─────────────────────────
-- The OAuth user has posted nothing yet, so it is not blocked by the
-- per-user posting limiter.
select tests_act_as('authenticated', '44444444-4444-4444-8444-444444444444');
insert into public.comments (author_id, novel_id, kind, body, rating)
values ('44444444-4444-4444-8444-444444444444', 'novel-9', 'review', 'A solid read.', 4);

select tests_act_as('anon', null);
select is(
  (select average_rating from public.novel_rating_summary where novel_id = 'novel-9'),
  4.00::numeric,
  'anonymous readers aggregate visible review ratings'
);
select is(
  (select rating_count from public.novel_rating_summary where novel_id = 'novel-9'),
  1,
  'the review count is aggregated'
);
select is(
  (select count(*)::int from public.novel_rating_distribution where novel_id = 'novel-9' and stars = 4),
  1,
  'the rating distribution buckets visible reviews by star'
);
select is(
  (select review_count from public.profile_activity_summary where user_id = '44444444-4444-4444-8444-444444444444'),
  1,
  'profile activity counts visible reviews'
);
select is(
  (select count(*)::int from public.novel_rating_summary where novel_id = 'novel-1'),
  0,
  'novels without reviews are absent from the summary'
);

-- ── Comment edit history ───────────────────────────────────────────
-- The author already edited aaaa…0001 once above (before it was soft-deleted);
-- history is private and deletions add nothing.
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.comment_revisions where comment_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'an author edit records exactly one revision'
);
select is(
  (select previous_body from public.comment_revisions where comment_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1),
  'my comment',
  'the revision keeps the previous body'
);

select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.comment_revisions where comment_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0,
  'an unrelated reader cannot read edit history'
);

select tests_act_as('anon', null);
select throws_ok(
  $$ select count(*) from public.comment_revisions $$,
  '42501',
  null,
  'anonymous visitors cannot read edit history'
);

select tests_act_as('authenticated', '33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.comment_revisions where comment_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'a moderator can read edit history'
);

-- ── Reading shelves (owner-only) ───────────────────────────────────
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
insert into public.reading_shelves (user_id, novel_id, shelf)
values ('11111111-1111-4111-8111-111111111111', 'novel-1', 'want');
select is(
  (select shelf from public.reading_shelves where novel_id = 'novel-1'),
  'want',
  'an owner can set a shelf'
);

select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ insert into public.reading_shelves (user_id, novel_id, shelf)
     values ('11111111-1111-4111-8111-111111111111', 'novel-2', 'want') $$,
  '42501',
  null,
  'a reader cannot write into another reader''s shelves'
);
select is(
  (select count(*)::int from public.reading_shelves),
  0,
  'a reader cannot see another reader''s shelves'
);

select tests_act_as('anon', null);
select throws_ok(
  $$ insert into public.reading_shelves (user_id, novel_id, shelf)
     values ('11111111-1111-4111-8111-111111111111', 'novel-3', 'reading') $$,
  '42501',
  null,
  'anonymous visitors cannot write shelves'
);

select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
delete from public.reading_shelves where novel_id = 'novel-1';
select is(
  (select count(*)::int from public.reading_shelves),
  0,
  'an owner can remove their own shelf entry'
);


-- ── Notifications: reply, mention, like ─────────────────────────────
-- A posts a comment; B replies and mentions both A and the moderator. The
-- reply notifies A once (the mention of A must not duplicate it) and notifies
-- the moderator.
select tests_reset_rate_limits();
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
insert into public.comments (author_id, novel_id, chapter_id, body)
values ('11111111-1111-4111-8111-111111111111', 'notif-novel', 'notif-ch', 'root comment');

select tests_reset_rate_limits();
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
insert into public.comments (author_id, novel_id, chapter_id, body, parent_id)
values (
  '22222222-2222-4222-8222-222222222222', 'notif-novel', 'notif-ch',
  'reply to @alice_writer and @mod',
  (select id from public.comments where novel_id = 'notif-novel' and chapter_id = 'notif-ch' and parent_id is null)
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'reply'),
  1,
  'a reply notifies the parent comment author'
);

select is(
  (select actor_id from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'reply'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'a reply notification records the actor'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'mention'),
  0,
  'mentioning the reply recipient does not duplicate the reply notification'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '33333333-3333-4333-8333-333333333333' and kind = 'mention'),
  1,
  'an @mention notifies the mentioned reader'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'a comment never notifies its own author'
);

-- An upvote notifies the author; liking your own comment does not.
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
insert into public.comment_likes (comment_id, user_id)
values (
  (select id from public.comments where novel_id = 'notif-novel' and parent_id is null),
  '22222222-2222-4222-8222-222222222222'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'like'),
  1,
  'an upvote notifies the comment author'
);

select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
insert into public.comment_likes (comment_id, user_id)
values (
  (select id from public.comments where novel_id = 'notif-novel' and parent_id is null),
  '11111111-1111-4111-8111-111111111111'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'like'),
  1,
  'liking your own comment sends no notification'
);

-- Privacy: notifications are strictly per recipient.
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111'),
  0,
  'one reader cannot read another reader''s notifications'
);

select throws_ok(
  $$ insert into public.notifications (user_id, kind, novel_id)
     values ('11111111-1111-4111-8111-111111111111', 'reply', 'notif-novel') $$,
  '42501',
  null,
  'clients cannot forge notifications'
);

select tests_act_as('anon', null);
select throws_ok(
  $$ select * from public.notifications $$,
  '42501',
  null,
  'anonymous visitors cannot read notifications'
);

-- Read state is owner-only and reports the changed row count.
select tests_act_as('authenticated', '11111111-1111-4111-8111-111111111111');
select ok(
  public.mark_all_notifications_read() >= 1,
  'mark-all-read reports the notifications it changed'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '11111111-1111-4111-8111-111111111111' and read_at is null),
  0,
  'mark-all-read clears the recipient inbox'
);

-- Soft-deleting a comment prunes the notifications it produced.
select tests_act_as('authenticated', '22222222-2222-4222-8222-222222222222');
select public.delete_own_comment(
  (select id from public.comments where novel_id = 'notif-novel' and parent_id is not null)
);
select is(
  (select count(*)::int from public.notifications where kind in ('reply', 'mention')),
  0,
  'soft-deleting a comment removes its notifications'
);

select * from finish();
rollback;
