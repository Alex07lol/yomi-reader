-- ════════════════════════════════════════════════════════════════════
-- Yomi Reader — Comment editing history
-- ════════════════════════════════════════════════════════════════════
-- Every edit of a comment body keeps the previous text so readers can see how
-- a comment changed. Prior bodies can contain content the author later removed,
-- so history is readable only by the author and by moderators — never by other
-- readers or anonymous visitors.

create table if not exists public.comment_revisions (
  id bigint generated always as identity primary key,
  comment_id uuid not null references public.comments(id) on delete cascade,
  editor_id uuid not null references auth.users(id) on delete cascade,
  previous_body text not null,
  revised_at timestamptz not null default now(),
  constraint comment_revisions_body_check check (char_length(previous_body) between 1 and 4000)
);

create index if not exists comment_revisions_comment_idx
  on public.comment_revisions (comment_id, revised_at desc);

comment on table public.comment_revisions is
  'Previous bodies of edited comments. Readable only by the author and moderators.';

-- Records the body being replaced whenever an author edits a visible comment.
-- Status transitions (hide/restore/soft-delete) never create history.
create or replace function public.tg_comments_record_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.body is distinct from old.body and new.status is not distinct from old.status then
    insert into public.comment_revisions (comment_id, editor_id, previous_body)
    values (old.id, coalesce(auth.uid(), old.author_id), old.body);
  end if;
  return new;
end;
$$;

drop trigger if exists comments_record_revision on public.comments;
create trigger comments_record_revision
  after update on public.comments
  for each row execute function public.tg_comments_record_revision();

alter table public.comment_revisions enable row level security;

-- Only the author and moderators can read history. No client INSERT/UPDATE/DELETE:
-- revisions are written exclusively by the SECURITY DEFINER trigger above.
drop policy if exists comment_revisions_select_author_or_moderator on public.comment_revisions;
create policy comment_revisions_select_author_or_moderator on public.comment_revisions
  for select using (
    editor_id = auth.uid() or public.is_community_moderator()
  );

revoke all on public.comment_revisions from anon, authenticated;
grant select on public.comment_revisions to authenticated;
