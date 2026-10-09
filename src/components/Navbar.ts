/* ─── Navbar Component ─── */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import { renderThemeSelector } from './ThemeSelector';

export function renderNavbar(
  container: HTMLElement,
  currentRoute: string,
  onSearch?: (query: string) => void,
  initialSearch = '',
): void {
  empty(container);

  const isReader = currentRoute.startsWith('reader');

  const nav = el('nav', { className: 'navbar' },
    el('div', { className: 'navbar-inner container' },
      el('div', { className: 'navbar-brand-container' },
        el('button', {
          className: 'navbar-brand',
          onclick: () => router.navigate('library'),
        }, 'Yomi'),
      ),
      el('div', { className: 'navbar-center' },
        !isReader ? el('input', {
          type: 'search',
          className: 'navbar-search',
          placeholder: 'Search novels…',
          value: initialSearch,
          'aria-label': 'Search novels',
          oninput: (e: Event) => {
            const query = (e.target as HTMLInputElement).value;
            onSearch?.(query);
          },
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              const query = (e.currentTarget as HTMLInputElement).value;
              router.navigate(`library?search=${encodeURIComponent(query)}`);
            }
          },
        }) : null,
      ),
      el('div', { className: 'navbar-actions' },
        currentRoute === 'library' ? el('button', {
          className: 'navbar-add-book',
          type: 'button',
          onclick: () => router.navigate('admin'),
        }, el('span', { className: 'navbar-add-book-plus', 'aria-hidden': 'true', text: '+' }), 'Add book') : null,
        el('div', { className: 'navbar-theme-container' }),
      ),
    ),
  );

  container.appendChild(nav);
  renderThemeSelector(nav.querySelector('.navbar-theme-container')!);
}
