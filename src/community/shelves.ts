/* ─── Account shelf sync ───
   The IndexedDB copy is always the working set. When a reader is signed in this
   module mirrors their shelves to Supabase and merges on sign-in with a
   last-write-wins rule. A failed or offline request never blocks the reader;
   local shelves simply stay authoritative until the next successful sync. */

import { getCommunityClient } from './supabase';
import { getAllShelveRows, replaceAllShelves } from '../storage/shelves';
import { isShelfId } from '../storage/shelves';
import type { ReadingShelf, ShelfId } from '../models';

interface RemoteRow {
  novel_id: string;
  shelf: string;
  deleted: boolean;
  updated_at: string;
}

interface UpsertRow {
  user_id: string;
  novel_id: string;
  shelf: ShelfId;
  deleted: boolean;
  updated_at: string;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Pushes one local shelf change to the account copy. Best-effort. */
export async function pushShelfChange(shelf: ReadingShelf): Promise<void> {
  const client = await getCommunityClient();
  if (!client) return;
  const { data } = await client.auth.getUser();
  if (!data.user) return;
  const row: UpsertRow = {
    user_id: data.user.id,
    novel_id: shelf.novelId,
    shelf: shelf.shelf,
    deleted: Boolean(shelf.deleted),
    updated_at: toIso(shelf.updatedAt),
  };
  // A failure here is non-fatal: the next sync will retry the local state.
  await client.from('reading_shelves').upsert(row, { onConflict: 'user_id,novel_id' });
}

/**
 * Merges local and account shelves (last write wins) and writes the result to
 * both sides. Never throws: an offline account merge leaves local data intact.
 */
export async function syncShelvesWithAccount(): Promise<void> {
  const client = await getCommunityClient();
  if (!client) return;
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return;
  const userId = userData.user.id;

  const local = await getAllShelveRows();
  const { data, error } = await client
    .from('reading_shelves')
    .select('novel_id,shelf,deleted,updated_at');
  if (error) return;

  const remote = ((data ?? []) as RemoteRow[]).filter(row => isShelfId(row.shelf)) as (RemoteRow & { shelf: ShelfId })[];
  const localById = new Map(local.map(row => [row.novelId, row]));
  const merged: ReadingShelf[] = [];
  const toPush: UpsertRow[] = [];

  for (const row of remote) {
    const remoteAt = Date.parse(row.updated_at);
    const localRow = localById.get(row.novel_id);
    localById.delete(row.novel_id);

    if (localRow && localRow.updatedAt > remoteAt) {
      toPush.push({ user_id: userId, novel_id: localRow.novelId, shelf: localRow.shelf, deleted: Boolean(localRow.deleted), updated_at: toIso(localRow.updatedAt) });
      merged.push(localRow);
    } else {
      merged.push({
        novelId: row.novel_id,
        shelf: row.shelf,
        updatedAt: Number.isFinite(remoteAt) ? remoteAt : Date.now(),
        deleted: Boolean(row.deleted),
      });
    }
  }

  for (const localRow of localById.values()) {
    toPush.push({ user_id: userId, novel_id: localRow.novelId, shelf: localRow.shelf, deleted: Boolean(localRow.deleted), updated_at: toIso(localRow.updatedAt) });
    merged.push(localRow);
  }

  if (toPush.length > 0) {
    await client.from('reading_shelves').upsert(toPush, { onConflict: 'user_id,novel_id' });
  }
  await replaceAllShelves(merged);
}
