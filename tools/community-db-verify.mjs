/*
 * Direct database authorization verification for the Yomi community schema.
 *
 * The hosted Supabase stack is not available in this environment, so this
 * harness boots a real PostgreSQL engine (PGlite / WASM), recreates the
 * minimal `auth` and `storage` schemas that Supabase provides, applies the
 * exact migration files from `supabase/migrations`, and then exercises every
 * Row Level Security policy as `anon`, as user A, as user B and as a moderator.
 *
 * It is a verification aid, not a production server. Run with `npm run db:verify`.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = (name) => readFileSync(join(root, 'supabase', 'migrations', name), 'utf8');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const MOD = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const OAUTH_USER = '55555555-5555-4555-8555-555555555555';
const META_LESS = '66666666-6666-4666-8666-666666666666';

let passes = 0;
let failures = 0;
const failedLabels = [];

function check(condition, label) {
  if (condition) { passes += 1; }
  else { failures += 1; failedLabels.push(label); console.error(`  FAIL  ${label}`); }
}

async function exec(text) { return db.exec(text); }
async function query(text) { return db.query(text); }
async function scalar(text) {
  const result = await db.query(text);
  const row = result.rows[0];
  if (!row) return undefined;
  return row[Object.keys(row)[0]];
}

async function expectError(sqlText, label, code) {
  try {
    await db.exec(sqlText);
    check(false, `${label} (expected an error, none raised)`);
  } catch (error) {
    const message = String(error?.message ?? error);
    const okCode = !code || message.includes(code) || String(error?.code ?? '') === code;
    check(okCode, `${label} [got: ${message}]`);
  }
}

let activeRole = null;
let activeUid = '';

async function applyRole() {
  await exec(`set role ${activeRole}`);
  await exec(`select set_config('request.jwt.claim.sub', ${activeUid ? `'${activeUid}'` : "''"}, false)`);
  await exec(`select set_config('request.jwt.role', ${activeRole === 'anon' ? "'anon'" : "'authenticated'"}, false)`);
}

async function asRole(role, uid, fn) {
  const previousRole = activeRole;
  const previousUid = activeUid;
  activeRole = role;
  activeUid = uid ?? '';
  await applyRole();
  try {
    return await fn();
  } finally {
    activeRole = previousRole;
    activeUid = previousUid;
    if (activeRole) await applyRole();
    else { await exec('reset role'); await exec(`select set_config('request.jwt.claim.sub', '', false)`); }
  }
}

async function clearRateLimits() {
  if (activeRole) await exec('reset role');
  await exec('delete from public.community_rate_events');
  if (activeRole) await applyRole();
}

const db = await PGlite.create();

console.log('Bootstrapping a Supabase-like environment…');
await exec(`
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $fn$;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id),
    name text not null,
    owner uuid
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.objects to anon, authenticated;
  grant insert, update, delete on storage.objects to authenticated;
  create function storage.foldername(p_name text) returns text[] language sql immutable as $fn$
    select string_to_array(p_name, '/')
  $fn$;
`);

console.log('Applying migrations…');
await exec(migration('20261009000100_community_core.sql'));
await exec(migration('20261009000200_community_avatars.sql'));
await exec(migration('20261009000300_community_ratings_profiles.sql'));
await exec(migration('20261009000400_comment_revisions.sql'));
await exec(migration('20261009000500_reading_shelves.sql'));
await exec(migration('20261009000600_community_notifications.sql'));
await exec(migration('20261011000100_reading_shelves_dropped.sql'));

console.log('Seeding users through the auth trigger…');
await exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${USER_A}', 'a@example.test', '{"username":"Alice_Writer"}'),
    ('${USER_B}', 'b@example.test', '{"username":"Bob"}'),
    ('${MOD}',   'm@example.test', '{"username":"Mod"}'),
    ('${STRANGER}', 's@example.test', '{"username":"stranger!!!"}'),
    ('${OAUTH_USER}', 'oauth@example.test', '{"name":"Jordan Lee"}'),
    ('${META_LESS}', 'bare@example.test', '{}');
`);

check(await scalar(`select count(*)::int from public.profiles`) === 6, 'auth trigger creates a profile for each new user');
check(await scalar(`select username from public.profiles where id = '${USER_A}'`) === 'alice_writer', 'profile username is lowercased from signup metadata');
check((await scalar(`select username from public.profiles where id = '${STRANGER}'`)).startsWith('stranger'), 'invalid username characters are stripped');
check(await scalar(`select username from public.profiles where id = '${OAUTH_USER}'`) === 'jordanlee', 'OAuth sign-ups derive a username from the provider display name');
check((await scalar(`select username from public.profiles where id = '${META_LESS}'`)).startsWith('reader_'), 'a sign-up with no usable metadata gets a generated username');

await exec(`insert into public.moderators (user_id, granted_by) values ('${MOD}', null)`);

console.log('\n--- Anonymous read access ---');
await clearRateLimits();
await asRole('anon', null, async () => {
  check(await scalar('select count(*)::int from public.comments') === 0, 'anon sees no comments in an empty thread');
  check((await scalar(`select public.is_community_moderator()`)) === false, 'anon is never a moderator');
});

// User A creates a novel review and chapter comments.
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, kind, body, rating)
              values ('${USER_A}', 'novel-1', null, 'review', 'A thoughtful review.', 5)`);
});
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, kind, body)
              values ('${USER_A}', 'novel-1', 'chapter-1', 'comment', 'Chapter one remark')`);
});
await clearRateLimits();
await asRole('authenticated', USER_B, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, kind, body)
              values ('${USER_B}', 'novel-2', 'chapter-1', 'comment', 'Different novel chapter one')`);
});

const novelOneComment = await scalar(`select id from public.comments where novel_id='novel-1' and chapter_id='chapter-1' and author_id='${USER_A}'`);
const novelTwoComment = await scalar(`select id from public.comments where novel_id='novel-2' and chapter_id='chapter-1'`);

console.log('\n--- Thread scoping and stability ---');
check(await scalar(`select count(*)::int from public.comments where novel_id='novel-1' and chapter_id='chapter-1'`) === 1, 'novel-1/chapter-1 has exactly its own comment');
check(await scalar(`select count(*)::int from public.comments where novel_id='novel-2' and chapter_id='chapter-1'`) === 1, 'novel-2/chapter-1 is a separate thread');
check(await scalar(`select count(*)::int from public.comments where novel_id='novel-1' and chapter_id is null`) === 1, 'novel-level thread is separate from chapter threads');

console.log('\n--- Insert authorization ---');
await clearRateLimits();
await asRole('anon', null, async () => {
  await expectError(
    `insert into public.comments (author_id, novel_id, body) values ('${USER_A}', 'novel-1', 'anonymous post')`,
    'anonymous cannot insert a comment',
    'permission denied'
  );
});
await asRole('authenticated', USER_A, async () => {
  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, body) values ('${USER_B}', 'novel-1', 'impersonation')`,
    'user A cannot post as user B (server-enforced authorship)',
    '42501'
  );
  await clearRateLimits();
  await exec(`insert into public.comments (author_id, novel_id, body, status) values ('${USER_A}', 'novel-1', 'pre-hidden-insert', 'hidden')`);
});

check(await scalar(`select status from public.comments where body='pre-hidden-insert'`) === 'visible', 'client-supplied moderation status is coerced on insert');

console.log('\n--- Update / delete authorization ---');
await asRole('authenticated', USER_A, async () => {
  await exec(`update public.comments set body='edited by author' where id='${novelOneComment}'`);
});
check(await scalar(`select body from public.comments where id='${novelOneComment}'`) === 'edited by author', 'author can edit their own comment body');

await asRole('authenticated', USER_B, async () => {
  await exec(`update public.comments set body='hijacked' where id='${novelOneComment}'`);
});
await asRole('authenticated', USER_A, async () => {
  await expectError(`update public.comments set novel_id='novel-9' where id='${novelOneComment}'`, 'scope cannot be changed', '42501');
});
check(await scalar(`select body from public.comments where id='${novelOneComment}'`) === 'edited by author', "user B cannot edit user A's comment");

await asRole('authenticated', USER_B, async () => {
  await expectError(`select public.delete_own_comment('${novelOneComment}')`, "another user cannot delete A's comment through the RPC", '42501');
});
check(await scalar(`select status from public.comments where id='${novelOneComment}'`) === 'visible', 'comment survives an unauthorized delete attempt');

await asRole('authenticated', USER_A, async () => {
  await expectError(`update public.comments set status='hidden' where id='${novelOneComment}'`, 'author cannot hide their own comment', '42501');
});

console.log('\n--- Replies: scope, depth and deleted parents ---');
await clearRateLimits();
let replyId;
await asRole('authenticated', USER_B, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, kind, body, parent_id)
              values ('${USER_B}', 'novel-1', 'chapter-1', 'comment', 'A valid reply', '${novelOneComment}')`);
  replyId = await scalar(`select id from public.comments where parent_id='${novelOneComment}'`);

  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, kind, body, parent_id)
     values ('${USER_B}', 'novel-2', 'chapter-1', 'comment', 'cross-thread reply', '${novelOneComment}')`,
    'a reply cannot cross into another novel/chapter',
    '23514'
  );

  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, kind, body, rating, parent_id)
     values ('${USER_B}', 'novel-1', 'chapter-1', 'review', 'rated reply', 4, '${novelOneComment}')`,
    'a reply cannot be a rated review'
  );

  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, kind, body, parent_id)
     values ('${USER_B}', 'novel-1', 'chapter-1', 'comment', 'nested too deep', '${replyId}')`,
    'replies are limited to one level',
    '23514'
  );
});

console.log('\n--- Likes ---');
await asRole('authenticated', USER_B, async () => {
  await exec(`insert into public.comment_likes (comment_id, user_id) values ('${novelOneComment}', '${USER_B}')`);
  await expectError(
    `insert into public.comment_likes (comment_id, user_id) values ('${novelOneComment}', '${USER_B}')`,
    'duplicate like is rejected',
    'duplicate key'
  );
  await expectError(
    `insert into public.comment_likes (comment_id, user_id) values ('${novelOneComment}', '${USER_A}')`,
    'a user cannot like on behalf of someone else',
    '42501'
  );
});
check(await scalar(`select count(*)::int from public.comment_likes where comment_id='${novelOneComment}'`) === 1, 'like count is correct after duplicate attempt');
await asRole('authenticated', USER_B, async () => {
  await exec(`delete from public.comment_likes where comment_id='${novelOneComment}' and user_id='${USER_B}'`);
});
check(await scalar(`select count(*)::int from public.comment_likes where comment_id='${novelOneComment}'`) === 0, 'a user can unlike their own like');

console.log('\n--- Reports ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comment_reports (comment_id, reporter_id, reason, details)
              values ('${novelTwoComment}', '${USER_A}', 'spam', 'looks like spam')`);
  await expectError(
    `insert into public.comment_reports (comment_id, reporter_id, reason) values ('${novelTwoComment}', '${USER_A}', 'spam')`,
    'the same user cannot report the same comment twice',
    'duplicate key'
  );
  await expectError(
    `insert into public.comment_reports (comment_id, reporter_id, reason) values ('${novelOneComment}', '${USER_A}', 'abuse')`,
    'a user cannot report their own comment',
    '23514'
  );
});
check(await scalar(`select count(*)::int from public.comment_reports where reporter_id='${USER_A}'`) === 1, 'the report was recorded once');

console.log('\n--- Report privacy ---');
await asRole('authenticated', USER_B, async () => {
  check(await scalar(`select count(*)::int from public.comment_reports where comment_id='${novelTwoComment}'`) === 0, 'another reader cannot see private reports');
});
await asRole('authenticated', USER_A, async () => {
  check(await scalar(`select count(*)::int from public.comment_reports where comment_id='${novelTwoComment}'`) === 1, 'the reporter can see their own report');
});
await asRole('authenticated', MOD, async () => {
  check(await scalar(`select count(*)::int from public.comment_reports`) >= 1, 'a moderator can read all reports');
});

console.log('\n--- Posting rate limits (database-enforced) ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_A}', 'novel-1', 'chapter-3', 'first quick post')`);
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_A}', 'novel-1', 'chapter-3', 'second quick post')`,
    'a second comment within seconds is rejected',
    'P0001'
  );
});
await clearRateLimits();
await exec(`insert into public.community_rate_events (user_id, action, created_at)
           select '${USER_B}', 'comment', now() - interval '1 hour' from generate_series(1, 30)`);
await asRole('authenticated', USER_B, async () => {
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_B}', 'novel-2', 'chapter-4', 'over the daily cap')`,
    'the rolling 24h posting cap is enforced',
    'P0001'
  );
});
await clearRateLimits();

console.log('\n--- Moderation ---');
await asRole('authenticated', USER_A, async () => {
  await expectError(`select public.set_comment_visibility('${novelOneComment}', 'hidden')`, 'a normal user cannot hide comments', '42501');
});
await asRole('anon', null, async () => {
  await expectError(`select public.set_comment_visibility('${novelOneComment}', 'hidden')`, 'an anonymous visitor cannot hide comments', 'permission denied');
});
await asRole('authenticated', MOD, async () => {
  check((await scalar('select public.is_community_moderator()')) === true, 'a moderator is recognized by the helper function');
  await exec(`select public.set_comment_visibility('${novelOneComment}', 'hidden')`);
});
check(await scalar(`select status from public.comments where id='${novelOneComment}'`) === 'hidden', 'a moderator can hide a comment');
await asRole('anon', null, async () => {
  check(await scalar(`select count(*)::int from public.comments where id='${novelOneComment}'`) === 0, 'hidden comments are invisible to anonymous readers');
});
await asRole('authenticated', USER_A, async () => {
  check(await scalar(`select count(*)::int from public.comments where id='${novelOneComment}'`) === 1, 'an author can still see their hidden comment');
  // RLS matches zero rows for a hidden comment, so this is a safe no-op.
  await exec(`update public.comments set body='sneaky edit' where id='${novelOneComment}'`);
});
check(await scalar(`select body from public.comments where id='${novelOneComment}'`) === 'edited by author', 'a hidden comment cannot be edited by its author');
await asRole('authenticated', MOD, async () => {
  await exec(`select public.set_comment_visibility('${novelOneComment}', 'visible')`);
  await expectError(`update public.comments set body='moderator rewrite' where id='${novelOneComment}'`, 'a moderator may not rewrite comment bodies', '42501');
});
check(await scalar(`select status from public.comments where id='${novelOneComment}'`) === 'visible', 'a moderator can restore a hidden comment');
check(await scalar(`select body from public.comments where id='${novelOneComment}'`) === 'edited by author', 'moderator restore did not change the body');

await asRole('authenticated', MOD, async () => {
  await exec(`update public.comment_reports set status='actioned' where reporter_id='${USER_A}'`);
});
check(await scalar(`select status from public.comment_reports where reporter_id='${USER_A}'`) === 'actioned', 'a moderator can review a report');
await asRole('authenticated', USER_B, async () => {
  await exec(`update public.comment_reports set status='dismissed' where reporter_id='${USER_A}'`);
});
check(await scalar(`select status from public.comment_reports where reporter_id='${USER_A}'`) === 'actioned', 'a normal user cannot change report status');

console.log('\n--- Privileged tables and self-granted permissions ---');
await asRole('authenticated', USER_A, async () => {
  await expectError(`insert into public.moderators (user_id) values ('${USER_A}')`, 'a user cannot grant themselves moderator access', 'permission denied');
  await expectError(`select * from public.moderators`, 'the moderators table is not directly readable', 'permission denied');
  await expectError(`select * from public.community_rate_events`, 'private rate-limit state is not readable', 'permission denied');
});
await asRole('authenticated', USER_A, async () => {
  check(await scalar(`select count(*)::int from public.user_restrictions`) === 0, 'a user sees no restrictions until one applies');
});

console.log('\n--- Restrictions ---');
await asRole('authenticated', MOD, async () => {
  await exec(`select public.set_user_restriction('${USER_B}', true, 'repeated spam', 24)`);
});
check(await scalar(`select count(*)::int from public.user_restrictions where user_id='${USER_B}' and lifted_at is null`) === 1, 'a moderator can restrict a user');
await clearRateLimits();
await asRole('authenticated', USER_B, async () => {
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_B}', 'novel-2', 'chapter-5', 'still posting')`,
    'a restricted user cannot post',
    '42501'
  );
  check(await scalar(`select count(*)::int from public.user_restrictions`) === 1, 'a restricted user can see their own restriction');
});
await asRole('authenticated', MOD, async () => {
  await exec(`select public.set_user_restriction('${USER_B}', false, 'unused')`);
  await expectError(`select public.set_user_restriction('${MOD}', true, 'self restriction')`, 'a moderator cannot restrict themselves');
});
await clearRateLimits();
await asRole('authenticated', USER_B, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_B}', 'novel-2', 'chapter-5', 'posting again')`);
});
check(await scalar(`select count(*)::int from public.comments where author_id='${USER_B}' and chapter_id='chapter-5'`) === 1, 'lifting a restriction restores posting');

console.log('\n--- Review constraints ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await expectError(
    `insert into public.comments (author_id, novel_id, chapter_id, kind, body, rating) values ('${USER_A}', 'novel-1', 'chapter-1', 'review', 'chapter review', 4)`,
    'a review cannot target a chapter',
    '23514'
  );
  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, kind, body, rating) values ('${USER_A}', 'novel-1', 'review', 'bad rating', 9)`,
    'a rating must be between 1 and 5',
    '23514'
  );
  await clearRateLimits();
  await expectError(
    `insert into public.comments (author_id, novel_id, body) values ('${USER_A}', 'novel-1', '   ')`,
    'a whitespace-only comment is rejected',
    '23514'
  );
});

console.log('\n--- Avatar storage policies ---');
await asRole('anon', null, async () => {
  await expectError(
    `insert into storage.objects (bucket_id, name) values ('avatars', '${USER_A}/anon.png')`,
    'an anonymous visitor cannot upload an avatar',
    'permission denied'
  );
});
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into storage.objects (bucket_id, name, owner) values ('avatars', '${USER_A}/me.png', '${USER_A}')`);
  await expectError(
    `insert into storage.objects (bucket_id, name, owner) values ('avatars', '${USER_B}/notmine.png', '${USER_A}')`,
    "a user cannot write into another user's avatar folder",
    'row-level security'
  );
  await exec(`delete from storage.objects where name = '${USER_B}/notmine.png'`);
});
check(await scalar(`select count(*)::int from storage.objects where name='${USER_A}/me.png'`) === 1, 'a user can upload to their own avatar folder');
await asRole('authenticated', USER_B, async () => {
  await exec(`delete from storage.objects where name='${USER_A}/me.png'`);
});
check(await scalar(`select count(*)::int from storage.objects where name='${USER_A}/me.png'`) === 1, "a user cannot delete another user's avatar");
check(await scalar(`select public from storage.buckets where id='avatars'`) === true, 'the avatars bucket is public to read');
check(await scalar(`select file_size_limit from storage.buckets where id='avatars'`) === 2097152, 'the avatars bucket enforces a 2 MiB limit');


console.log('\n--- Rating aggregation (security_invoker views) ---');
await asRole('anon', null, async () => {
  const avg = await scalar(`select average_rating from public.novel_rating_summary where novel_id='novel-1'`);
  const count = await scalar(`select rating_count from public.novel_rating_summary where novel_id='novel-1'`);
  check(Number(avg) === 5 && Number(count) === 1, 'anonymous readers aggregate only visible reviews for a novel');
  check((await scalar(`select count(*)::int from public.novel_rating_summary where novel_id='novel-2'`)) === 0, 'a novel with no reviews is absent from the rating summary');
});
await asRole('authenticated', MOD, async () => {
  await exec(`select public.set_comment_visibility('${novelOneComment}', 'hidden')`);
});
await asRole('anon', null, async () => {
  const chapterReviewsHidden = await scalar(`select count(*)::int from public.novel_rating_summary where novel_id='novel-1'`);
  check(Number(chapterReviewsHidden) === 1, 'hiding a chapter comment does not remove the novel review aggregate');
});
await asRole('authenticated', MOD, async () => {
  await exec(`select public.set_comment_visibility('${novelOneComment}', 'visible')`);
  const reviewId = await scalar(`select id from public.comments where novel_id='novel-1' and kind='review'`);
  await exec(`select public.set_comment_visibility('${reviewId}', 'hidden')`);
});
await asRole('anon', null, async () => {
  check((await scalar(`select count(*)::int from public.novel_rating_summary where novel_id='novel-1'`)) === 0, 'a hidden review is excluded from the rating summary');
});
await asRole('authenticated', MOD, async () => {
  const reviewId = await scalar(`select id from public.comments where novel_id='novel-1' and kind='review'`);
  await exec(`select public.set_comment_visibility('${reviewId}', 'visible')`);
});
await asRole('anon', null, async () => {
  const stars = await scalar(`select star_count from public.novel_rating_distribution where novel_id='novel-1' and stars=5`);
  check(Number(stars) === 1, 'the rating distribution counts 5-star reviews');
});

console.log('\n--- Public profile activity ---');
await asRole('anon', null, async () => {
  const reviews = await scalar(`select review_count from public.profile_activity_summary where user_id='${USER_A}'`);
  check(Number(reviews) >= 1, 'a profile exposes the author\'s visible review count to anonymous readers');
  const likes = await scalar(`select likes_received from public.profile_activity_summary where user_id='${USER_A}'`);
  check(Number.isInteger(Number(likes)), 'upvotes received is an integer for every profile');
});


console.log('\n--- Owner soft-delete regression ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_A}', 'probe-novel', 'probe-ch', 'to delete')`);
});
const probeId = await scalar(`select id from public.comments where novel_id='probe-novel' and chapter_id='probe-ch'`);
await asRole('authenticated', USER_A, async () => {
  await exec(`select public.delete_own_comment('${probeId}')`);
});
check(await scalar(`select status from public.comments where id='${probeId}'`) === 'deleted', 'the owner can soft-delete their own comment through the RPC');
check(await scalar(`select body from public.comments where id='${probeId}'`) === '[deleted]', 'a soft delete replaces the body with the deleted marker');


console.log('\n--- Comment edit history ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body) values ('${USER_A}', 'hist-novel', 'hist-ch', 'v1')`);
});
const histId = await scalar(`select id from public.comments where novel_id='hist-novel' and chapter_id='hist-ch'`);
await asRole('authenticated', USER_A, async () => {
  await exec(`update public.comments set body='v2' where id='${histId}'`);
  await exec(`update public.comments set body='v3' where id='${histId}'`);
});
check(await scalar(`select count(*)::int from public.comment_revisions where comment_id='${histId}'`) === 2, 'each body edit records one revision');
check(await scalar(`select previous_body from public.comment_revisions where comment_id='${histId}' order by revised_at asc, id asc limit 1`) === 'v1', 'history keeps the earliest body first');
await asRole('authenticated', USER_B, async () => {
  check(await scalar(`select count(*)::int from public.comment_revisions where comment_id='${histId}'`) === 0, 'another reader cannot read edit history');
  await expectError(
    `insert into public.comment_revisions (comment_id, editor_id, previous_body) values ('${histId}', '${USER_B}', 'forged')`,
    'clients cannot forge edit history',
    'permission denied'
  );
});
await asRole('anon', null, async () => {
  await expectError(`select * from public.comment_revisions`, 'anonymous visitors cannot read edit history', 'permission denied');
});
await asRole('authenticated', MOD, async () => {
  check(await scalar(`select count(*)::int from public.comment_revisions where comment_id='${histId}'`) === 2, 'a moderator can read edit history');
});
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`select public.delete_own_comment('${histId}')`);
});
check(await scalar(`select count(*)::int from public.comment_revisions where comment_id='${histId}'`) === 2, 'a soft delete does not add a revision');

console.log('\n--- Reading shelves ---');
await asRole('anon', null, async () => {
  await expectError(
    `insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'novel-1', 'want')`,
    'anonymous visitors cannot write shelves',
    'permission denied'
  );
});
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'novel-1', 'want')`);
  await exec(`update public.reading_shelves set shelf='finished' where user_id='${USER_A}' and novel_id='novel-1'`);
  check(await scalar(`select shelf from public.reading_shelves where user_id='${USER_A}' and novel_id='novel-1'`) === 'finished', 'the owner can move a novel between shelves');
  await exec(`insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'novel-4', 'dropped')`);
  check(await scalar(`select shelf from public.reading_shelves where user_id='${USER_A}' and novel_id='novel-4'`) === 'dropped', 'the dropped shelf is accepted');
  await exec(`delete from public.reading_shelves where user_id='${USER_A}' and novel_id='novel-4'`);
  await expectError(
    `insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'novel-9', 'later')`,
    'only the known shelves are allowed',
    '23514'
  );
  await expectError(
    `insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'bad id!', 'want')`,
    'shelf novel ids are constrained',
    '23514'
  );
});
await asRole('authenticated', USER_B, async () => {
  check(await scalar(`select count(*)::int from public.reading_shelves`) === 0, "one reader cannot see another reader's shelves");
  await expectError(
    `insert into public.reading_shelves (user_id, novel_id, shelf) values ('${USER_A}', 'novel-2', 'want')`,
    "a reader cannot write into another reader's shelves",
    'row-level security'
  );
  await exec(`update public.reading_shelves set shelf='want' where user_id='${USER_A}'`);
});
check(await scalar(`select shelf from public.reading_shelves where user_id='${USER_A}' and novel_id='novel-1'`) === 'finished', "another reader cannot change a shelf they do not own");
await asRole('authenticated', USER_A, async () => {
  await exec(`delete from public.reading_shelves where user_id='${USER_A}' and novel_id='novel-1'`);
  check(await scalar(`select count(*)::int from public.reading_shelves where user_id='${USER_A}'`) === 0, 'a reader can remove their own shelf entry');
});


console.log('\n--- Notifications ---');
await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body)
              values ('${USER_A}', 'notif-novel', 'notif-ch', 'root comment')`);
});
const notifParent = await scalar(`select id from public.comments where novel_id='notif-novel' and chapter_id='notif-ch'`);

await clearRateLimits();
await asRole('authenticated', USER_B, async () => {
  // Mentions the parent author on purpose: that must not double-notify.
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body, parent_id)
              values ('${USER_B}', 'notif-novel', 'notif-ch', 'a reply to @alice_writer', '${notifParent}')`);
});
const notifReply = await scalar(`select id from public.comments where parent_id='${notifParent}'`);
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_A}' and comment_id='${notifReply}' and kind='reply'`)) === 1, 'a reply notifies the parent comment author');
check(await scalar(`select actor_id from public.notifications where user_id='${USER_A}' and comment_id='${notifReply}' and kind='reply'`) === USER_B, 'the reply notification records the actor');
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_A}' and comment_id='${notifReply}'`)) === 1, 'an @mention of the reply recipient does not duplicate the reply notification');

await clearRateLimits();
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comments (author_id, novel_id, chapter_id, body)
              values ('${USER_A}', 'notif-novel', 'notif-ch2', 'hello @mod and @bob')`);
});
const notifMention = await scalar(`select id from public.comments where novel_id='notif-novel' and chapter_id='notif-ch2'`);
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${MOD}' and comment_id='${notifMention}' and kind='mention'`)) === 1, 'an @mention notifies the mentioned reader');
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_B}' and comment_id='${notifMention}' and kind='mention'`)) === 1, 'every mentioned reader is notified');
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_A}' and actor_id='${USER_A}'`)) === 0, 'a comment never notifies its own author');
check(await scalar(`select novel_id from public.notifications where user_id='${MOD}' and comment_id='${notifMention}'`) === 'notif-novel', 'a mention notification carries the novel scope');

await asRole('authenticated', USER_B, async () => {
  await exec(`insert into public.comment_likes (comment_id, user_id) values ('${notifParent}', '${USER_B}')`);
});
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_A}' and comment_id='${notifParent}' and kind='like'`)) === 1, 'an upvote notifies the comment author');
await asRole('authenticated', USER_B, async () => {
  await exec(`delete from public.comment_likes where comment_id='${notifParent}' and user_id='${USER_B}'`);
});
check(Number(await scalar(`select count(*)::int from public.notifications where comment_id='${notifParent}' and kind='like'`)) === 0, 'removing the upvote clears its notification');
await asRole('authenticated', USER_A, async () => {
  await exec(`insert into public.comment_likes (comment_id, user_id) values ('${notifParent}', '${USER_A}')`);
});
check(Number(await scalar(`select count(*)::int from public.notifications where comment_id='${notifParent}' and kind='like'`)) === 0, 'liking your own comment sends no notification');

console.log('\n--- Notification privacy ---');
await asRole('authenticated', USER_B, async () => {
  check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_A}'`)) === 0, "one reader cannot read another reader's notifications");
  await expectError(
    `insert into public.notifications (user_id, kind, novel_id) values ('${USER_A}', 'reply', 'notif-novel')`,
    'clients cannot forge notifications',
    'permission denied'
  );
});
await asRole('anon', null, async () => {
  await expectError(`select * from public.notifications`, 'anonymous visitors cannot read notifications', 'permission denied');
});

console.log('\n--- Notification read state ---');
let unreadBeforeA = 0;
await asRole('authenticated', USER_A, async () => {
  unreadBeforeA = Number(await scalar(`select count(*)::int from public.notifications where read_at is null`));
  check(unreadBeforeA >= 1, 'the recipient has unread notifications');
  const changed = Number(await scalar(`select public.mark_all_notifications_read()`));
  check(changed === unreadBeforeA, 'mark-all-read reports every changed row');
  check(Number(await scalar(`select count(*)::int from public.notifications where read_at is null`)) === 0, 'mark-all-read clears the recipient inbox');
});
check(Number(await scalar(`select count(*)::int from public.notifications where user_id='${USER_B}' and read_at is null`)) === 1, "marking one reader's notifications read leaves another reader's inbox untouched");

await clearRateLimits();
await asRole('authenticated', USER_B, async () => {
  await exec(`select public.delete_own_comment('${notifReply}')`);
});
check(Number(await scalar(`select count(*)::int from public.notifications where comment_id='${notifReply}'`)) === 0, 'soft-deleting a comment removes its notifications');

console.log(`\n${passes} checks passed, ${failures} failed.`);
if (failures > 0) {
  console.error('Failed checks:');
  failedLabels.forEach((label) => console.error(`  - ${label}`));
  process.exitCode = 1;
}
