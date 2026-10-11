/* ─── Theme System ─── */

import type { ThemeId } from '../models';

export const THEME_CLASS_MAP: Record<ThemeId, string> = {
  midnight: 'theme-midnight',
  dark:     'theme-dark',
  light:    'theme-light',
  oled:     'theme-oled',
  sepia:    'theme-sepia',
  system:   'theme-system',
};

/** Browser/OS chrome colour for each concrete theme (used for `<meta name="theme-color">`). */
export const THEME_COLOR_MAP: Record<Exclude<ThemeId, 'system'>, string> = {
  midnight: '#171c26',
  dark: '#292b30',
  light: '#ffffff',
  oled: '#000000',
  sepia: '#f4ede4',
};

/** The concrete chrome colour for a theme id, resolving `system` first. */
export function themeColorFor(id: ThemeId): string {
  const concrete = id === 'system' ? resolveSystemTheme() : id;
  return THEME_COLOR_MAP[concrete as Exclude<ThemeId, 'system'>] ?? THEME_COLOR_MAP.midnight;
}

/** Keeps the mobile status bar / address bar in step with the active theme. */
function applyThemeColor(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themeColorFor(id);
}

export function resolveSystemTheme(): 'dark' | 'light' {
  // Some embedded webviews and test environments have no matchMedia.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  Object.values(THEME_CLASS_MAP).forEach(cls => root.classList.remove(cls));
  const resolved = id === 'system' ? resolveSystemTheme() : id;
  root.classList.add(THEME_CLASS_MAP[resolved === 'dark' ? 'dark' : resolved]);
  root.classList.add(THEME_CLASS_MAP[id]);
  applyThemeColor(id);
}

let systemListener: (() => void) | null = null;

export function listenForSystemChanges(onChange: (id: ThemeId) => void): void {
  systemListener?.();
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange('system');
  mq.addEventListener('change', handler);
  systemListener = () => mq.removeEventListener('change', handler);
}

export function stopListeningForSystemChanges(): void {
  systemListener?.();
  systemListener = null;
}