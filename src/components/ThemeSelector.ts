/* ─── Theme Selector Component ─── */

import { el, empty } from '../utils/dom';
import type { ThemeId } from '../models';
import { applyTheme } from '../theme';
import { loadUserSettings, saveUserSettings } from '../storage';
import { renderSelectMenu } from './SelectMenu';

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'dark',     label: 'Dark' },
  { id: 'light',    label: 'Light' },
  { id: 'oled',     label: 'OLED Black' },
  { id: 'sepia',    label: 'Sepia' },
  { id: 'system',   label: 'System' },
];

export function renderThemeSelector(container: HTMLElement): void {
  empty(container);

  loadUserSettings().then(settings => {
    const wrapper = el('div', { className: 'theme-selector' },
      renderSelectMenu('Theme', settings.theme, THEMES.map(t => ({ value: t.id, label: t.label })), async value => {
          const theme = value as ThemeId;
          applyTheme(theme);
          const s = await loadUserSettings();
          s.theme = theme;
          await saveUserSettings(s);
        }, 'theme-select-menu', 'Theme'),
    );

    container.appendChild(wrapper);
  });
}
