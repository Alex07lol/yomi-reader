import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_CLASS_MAP, THEME_COLOR_MAP, applyTheme, themeColorFor } from './index';

describe('theme chrome colour', () => {
  it('maps every concrete theme to a distinct chrome colour', () => {
    expect(themeColorFor('midnight')).toBe('#171c26');
    expect(themeColorFor('dark')).toBe('#292b30');
    expect(themeColorFor('light')).toBe('#ffffff');
    expect(themeColorFor('oled')).toBe('#000000');
    expect(themeColorFor('sepia')).toBe('#f4ede4');
    expect(Object.keys(THEME_COLOR_MAP)).toHaveLength(5);
    // Every value must be a valid hex colour for the mobile status bar.
    for (const value of Object.values(THEME_COLOR_MAP)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back to the dark chrome colour when matchMedia is unavailable', () => {
    expect(themeColorFor('system')).toBe('#292b30');
  });

  it('follows the system preference when matchMedia is available', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList;
    try {
      expect(themeColorFor('system')).toBe('#ffffff');
    } finally {
      (window as unknown as { matchMedia: typeof original }).matchMedia = original;
    }
  });
});

describe('applyTheme', () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    document.head.innerHTML = '';
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#000000');
    document.head.appendChild(meta);
  });

  it('keeps the meta theme-color in step with the active theme', () => {
    applyTheme('sepia');
    expect(meta.content).toBe('#f4ede4');
    applyTheme('oled');
    expect(meta.content).toBe('#000000');
    applyTheme('light');
    expect(meta.content).toBe('#ffffff');
  });

  it('applies the theme classes and clears the previous ones', () => {
    applyTheme('oled');
    expect(document.documentElement.classList.contains(THEME_CLASS_MAP.oled)).toBe(true);
    applyTheme('midnight');
    expect(document.documentElement.classList.contains(THEME_CLASS_MAP.oled)).toBe(false);
    expect(document.documentElement.classList.contains(THEME_CLASS_MAP.midnight)).toBe(true);
  });
});
