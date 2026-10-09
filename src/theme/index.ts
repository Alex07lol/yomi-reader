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

export function resolveSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  Object.values(THEME_CLASS_MAP).forEach(cls => root.classList.remove(cls));
  const resolved = id === 'system' ? resolveSystemTheme() : id;
  root.classList.add(THEME_CLASS_MAP[resolved === 'dark' ? 'dark' : resolved]);
  root.classList.add(THEME_CLASS_MAP[id]);
}

let systemListener: (() => void) | null = null;

export function listenForSystemChanges(onChange: (id: ThemeId) => void): void {
  systemListener?.();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange('system');
  mq.addEventListener('change', handler);
  systemListener = () => mq.removeEventListener('change', handler);
}

export function stopListeningForSystemChanges(): void {
  systemListener?.();
  systemListener = null;
}