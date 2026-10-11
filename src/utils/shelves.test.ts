import { describe, expect, it } from 'vitest';
import { SHELF_IDS, SHELF_LABELS, isShelfId } from './shelves';

describe('shelf constants', () => {
  it('exposes exactly the three supported shelves with labels', () => {
    expect(SHELF_IDS).toEqual(['want', 'reading', 'finished']);
    expect(SHELF_LABELS.want).toBe('Want to read');
    expect(SHELF_LABELS.reading).toBe('Reading');
    expect(SHELF_LABELS.finished).toBe('Finished');
  });

  it('validates unknown shelf values', () => {
    expect(isShelfId('want')).toBe(true);
    expect(isShelfId('finished')).toBe(true);
    expect(isShelfId('later')).toBe(false);
    expect(isShelfId(null)).toBe(false);
    expect(isShelfId(3)).toBe(false);
  });
});
