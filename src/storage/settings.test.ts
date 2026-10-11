import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './index';

describe('reader settings defaults', () => {
  it('includes the custom reading-style controls', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      fontSize: 18,
      lineHeight: 1.8,
      readingWidth: 720,
      pageMargin: 24,
      fontFamily: 'serif',
      textAlign: 'left',
      paragraphSpacing: 1.2,
      letterSpacing: 0,
    });
  });

  it('merges over previously saved settings that predate the new fields', () => {
    const legacy = { theme: 'dark', fontSize: 20 } as Partial<typeof DEFAULT_SETTINGS>;
    const merged = { ...DEFAULT_SETTINGS, ...legacy };
    expect(merged.fontSize).toBe(20);
    expect(merged.textAlign).toBe('left');
    expect(merged.paragraphSpacing).toBe(1.2);
    expect(merged.letterSpacing).toBe(0);
  });
});
