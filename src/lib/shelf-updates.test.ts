import { describe, expect, it } from 'vitest';
import { baselinesToEstablish, computeShelfUpdates, countChapters } from './shelf-updates';

const novels = [
  { id: 'a', title: 'Alpha', chapterCount: 12 },
  { id: 'b', title: 'Beta', chapterCount: 5 },
  { id: 'c', title: 'Gamma', chapterCount: 30 },
];

describe('countChapters', () => {
  it('reads the chapter list, tolerating a missing one', () => {
    expect(countChapters({ chapters: [1, 2, 3] })).toBe(3);
    expect(countChapters({ chapters: [] })).toBe(0);
    expect(countChapters({})).toBe(0);
    expect(countChapters({ chapters: undefined as unknown as unknown[] })).toBe(0);
  });
});

describe('computeShelfUpdates', () => {
  it('reports only shelved novels that gained chapters since their baseline', () => {
    const updates = computeShelfUpdates(
      novels,
      [{ novelId: 'a' }, { novelId: 'b' }, { novelId: 'c' }],
      { a: 10, b: 5, c: 31 },
    );

    expect(updates).toEqual([
      { novelId: 'a', title: 'Alpha', newChapters: 2, chapterCount: 12 },
    ]);
  });

  it('ignores novels that are not on a shelf, and shelves that were removed', () => {
    expect(computeShelfUpdates(novels, [], { a: 1, b: 1, c: 1 })).toEqual([]);
    expect(computeShelfUpdates(novels, [{ novelId: 'a', deleted: true }], { a: 1 })).toEqual([]);
    expect(computeShelfUpdates(novels, [{ novelId: 'a' }], { b: 1, c: 1 })).toEqual([]);
  });

  it('skips novels with no baseline rather than calling the whole book new', () => {
    expect(computeShelfUpdates(novels, [{ novelId: 'a' }], {})).toEqual([]);
    expect(computeShelfUpdates(novels, [{ novelId: 'a' }], { a: Number.NaN })).toEqual([]);
  });

  it('orders by how much is new, then by title', () => {
    const updates = computeShelfUpdates(
      [{ id: 'x', title: 'Zeta', chapterCount: 10 }, { id: 'y', title: 'Beta', chapterCount: 10 }, { id: 'z', title: 'Alpha', chapterCount: 10 }],
      [{ novelId: 'x' }, { novelId: 'y' }, { novelId: 'z' }],
      { x: 9, y: 5, z: 5 },
    );

    // Most new chapters first (Alpha and Beta tie at 5, so title breaks it), then Zeta.
    expect(updates.map(update => update.title)).toEqual(['Alpha', 'Beta', 'Zeta']);
    expect(updates.map(update => update.newChapters)).toEqual([5, 5, 1]);
  });
});

describe('baselinesToEstablish', () => {
  it('returns shelved novels that have never been seen', () => {
    expect(baselinesToEstablish(novels, [{ novelId: 'a' }, { novelId: 'b' }, { novelId: 'c', deleted: true }], { b: 5 }))
      .toEqual([{ novelId: 'a', chapterCount: 12 }]);
  });

  it('returns nothing once every shelved novel has a baseline', () => {
    expect(baselinesToEstablish(novels, [{ novelId: 'a' }], { a: 0 })).toEqual([]);
  });
});
