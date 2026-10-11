import { describe, expect, it } from 'vitest';
import { SHELF_IDS, SHELF_LABELS, isShelfId } from './shelves';

describe('shelf constants', () => {
  it('exposes the four supported shelves with the labels readers see', () => {
    expect(SHELF_IDS).toEqual(['want', 'reading', 'finished', 'dropped']);
    expect(SHELF_LABELS.want).toBe('Want to read');
    expect(SHELF_LABELS.reading).toBe('Reading');
    // The stored id stays `finished`; the reader sees "Completed".
    expect(SHELF_LABELS.finished).toBe('Completed');
    expect(SHELF_LABELS.dropped).toBe('Dropped');
  });

  it('validates unknown shelf values', () => {
    expect(isShelfId('want')).toBe(true);
    expect(isShelfId('finished')).toBe(true);
    expect(isShelfId('dropped')).toBe(true);
    expect(isShelfId('later')).toBe(false);
    expect(isShelfId(null)).toBe(false);
    expect(isShelfId(3)).toBe(false);
  });
});
