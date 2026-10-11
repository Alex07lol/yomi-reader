import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingShelf } from '../models';

const h = vi.hoisted(() => {
  const state = {
    local: [] as ReadingShelf[],
    remote: [] as unknown[],
    remoteError: null as unknown,
    upserts: [] as unknown[][],
    replaced: null as ReadingShelf[] | null,
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      select: () => ({ then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: state.remote, error: state.remoteError }).then(resolve) }),
      upsert: (rows: unknown[]) => {
        state.upserts.push(rows);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { state, client };
});

vi.mock('./supabase', () => ({
  getCommunityClient: async () => h.client,
  requireCommunityClient: async () => h.client,
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

vi.mock('../storage/shelves', () => ({
  getAllShelveRows: async () => h.state.local,
  replaceAllShelves: async (rows: ReadingShelf[]) => { h.state.replaced = rows; },
  isShelfId: (value: unknown) => value === 'want' || value === 'reading' || value === 'finished',
}));

const { syncShelvesWithAccount } = await import('./shelves');

const row = (novelId: string, shelf: ReadingShelf['shelf'], updatedAt: number, deleted = false): ReadingShelf =>
  ({ novelId, shelf, updatedAt, deleted });

beforeEach(() => {
  h.state.local = [];
  h.state.remote = [];
  h.state.remoteError = null;
  h.state.upserts = [];
  h.state.replaced = null;
});

describe('syncShelvesWithAccount', () => {
  it('adopts newer remote shelves and writes them locally', async () => {
    h.state.remote = [
      { novel_id: 'a', shelf: 'reading', deleted: false, updated_at: new Date(1000).toISOString() },
    ];
    await syncShelvesWithAccount();
    expect(h.state.replaced).toEqual([row('a', 'reading', 1000, false)]);
    expect(h.state.upserts).toHaveLength(0);
  });

  it('pushes a newer local shelf to the account', async () => {
    h.state.local = [row('a', 'finished', 5000)];
    h.state.remote = [
      { novel_id: 'a', shelf: 'want', deleted: false, updated_at: new Date(1000).toISOString() },
    ];
    await syncShelvesWithAccount();
    expect(h.state.upserts[0]).toEqual([
      { user_id: 'user-1', novel_id: 'a', shelf: 'finished', deleted: false, updated_at: new Date(5000).toISOString() },
    ]);
    expect(h.state.replaced).toEqual([row('a', 'finished', 5000)]);
  });

  it('pushes local-only shelves', async () => {
    h.state.local = [row('b', 'want', 2000)];
    await syncShelvesWithAccount();
    expect(h.state.upserts[0]).toHaveLength(1);
    expect(h.state.replaced).toEqual([row('b', 'want', 2000)]);
  });

  it('honours a remote tombstone that is newer than the local shelf', async () => {
    h.state.local = [row('a', 'reading', 1000)];
    h.state.remote = [
      { novel_id: 'a', shelf: 'reading', deleted: true, updated_at: new Date(9000).toISOString() },
    ];
    await syncShelvesWithAccount();
    expect(h.state.replaced).toEqual([row('a', 'reading', 9000, true)]);
  });

  it('never resurrects a locally-removed shelf', async () => {
    h.state.local = [row('a', 'reading', 8000, true)];
    h.state.remote = [
      { novel_id: 'a', shelf: 'reading', deleted: false, updated_at: new Date(1000).toISOString() },
    ];
    await syncShelvesWithAccount();
    expect(h.state.upserts[0]).toEqual([
      { user_id: 'user-1', novel_id: 'a', shelf: 'reading', deleted: true, updated_at: new Date(8000).toISOString() },
    ]);
    expect(h.state.replaced).toEqual([row('a', 'reading', 8000, true)]);
  });

  it('keeps local shelves when the account read fails', async () => {
    h.state.local = [row('a', 'want', 1000)];
    h.state.remoteError = { message: 'offline' };
    await syncShelvesWithAccount();
    expect(h.state.replaced).toBeNull();
    expect(h.state.upserts).toHaveLength(0);
  });
});
