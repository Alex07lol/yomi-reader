/* ─── Library Filters Component ─── */

import { el, empty } from '../utils/dom';
import type { LibraryFilters, SortOption, NovelStatus, LibraryOptions } from '../models';
import { renderSelectMenu } from './SelectMenu';

export interface FilterCallbacks {
  onToggleGenre: (g: string) => void;
  onToggleTag: (t: string) => void;
  onToggleSourceLang: (l: string) => void;
  onToggleStatus: (s: NovelStatus) => void;
  onSortChange: (s: SortOption) => void;
  onClear: () => void;
}

export function renderFilters(
  container: HTMLElement,
  filters: LibraryFilters,
  options: LibraryOptions,
  callbacks: FilterCallbacks,
): void {
  empty(container);

  const wrapper = el('div', { className: 'library-filters' });

  const clearRow = el('div', { className: 'filter-clear-row' },
    el('button', {
      className: 'filter-clear-btn',
      onclick: callbacks.onClear,
      text: 'Clear filters',
    }),
  );
  wrapper.appendChild(clearRow);

  // Sort
  const sortRow = el('div', { className: 'filter-sort-row' },
    el('label', { className: 'filter-label', text: 'Sort by' }),
    renderSelectMenu('Sort by', filters.sort, [
      { value: 'recently-added', label: 'Recently Added' },
      { value: 'recently-updated', label: 'Recently Updated' },
      { value: 'alphabetical', label: 'Alphabetical' },
      { value: 'chapter-count', label: 'Chapter Count' },
    ], value => callbacks.onSortChange(value as SortOption), 'filter-sort-menu'),
  );
  wrapper.appendChild(sortRow);

  const addFilterGroup = (label: string, items: string[], selected: string[], toggle: (v: string) => void) => {
    if (items.length === 0) return;
    const group = el('details', { className: 'filter-group' },
      el('summary', { className: 'filter-group-summary', text: label }),
      el('div', { className: 'filter-group-options' },
        ...items.map(item =>
          el('label', { className: `filter-chip${selected.includes(item) ? ' active' : ''}` },
            el('input', {
              type: 'checkbox',
              checked: selected.includes(item),
              onchange: () => toggle(item),
              style: 'display:none',
            }),
            el('span', { text: item }),
          ),
        ),
      ),
    );
    wrapper.appendChild(group);
  };

  addFilterGroup('Genres', options.genres, filters.genres, (v: string) => callbacks.onToggleGenre(v));
  addFilterGroup('Tags', options.tags, filters.tags, (v: string) => callbacks.onToggleTag(v));
  addFilterGroup('Source Language', options.sourceLanguages, filters.sourceLanguages, (v: string) => callbacks.onToggleSourceLang(v));

  const statuses: NovelStatus[] = ['ongoing', 'completed', 'hiatus', 'dropped'];
  addFilterGroup('Status', statuses, filters.status, (v: string) => callbacks.onToggleStatus(v as NovelStatus));

  container.appendChild(wrapper);
}
