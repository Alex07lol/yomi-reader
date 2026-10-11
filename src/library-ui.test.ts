/* ─── Library controls and account dialog: static contracts ───
   jsdom has no layout, so the dialog centring bug cannot be reproduced in a
   rendered test. The guards below pin the rules that made it work, following the
   raw-source contract tests already used for the mobile viewport. */

import { describe, expect, it } from 'vitest';
import communityCss from './styles/community.css?raw';
import componentsCss from './styles/components.css?raw';
import styleCss from './style.css?raw';
import filtersSource from './components/LibraryFilters.ts?raw';
import libraryPageSource from './pages/LibraryPage.ts?raw';

/** The text of a single `selector { … }` rule, so assertions stay scoped to it.
    Comments are stripped first: a `}` inside one would truncate the block. */
function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(`${selector} {`);
  return start === -1 ? '' : clean.slice(start, clean.indexOf('}', start));
}

describe('account dialog placement', () => {
  it('restores the auto margins the global reset removes', () => {
    // The premise: the app-wide reset zeroes every element's margin, which outranks
    // the UA stylesheet's `dialog { margin: auto }` and left-aligned the modal.
    expect(rule(styleCss, '*::after')).toMatch(/box-sizing:\s*border-box;[\s\S]*margin:\s*0/);

    // So the dialog has to opt back into being centred.
    expect(rule(communityCss, '.community-dialog')).toMatch(/margin:\s*auto/);
  });
});

describe('sidebar filters', () => {
  it('no longer offers a translation language group', () => {
    expect(filtersSource).not.toContain('Translation Language');
    expect(filtersSource).not.toContain('onToggleTransLang');
  });

  it('no longer offers a shelves group', () => {
    expect(filtersSource).not.toContain('filter-group-shelves');
    expect(filtersSource).not.toContain('SHELF_LABELS');
    expect(filtersSource).not.toContain('onToggleShelf');
  });
});

describe('bookmark control', () => {
  it('is a toggle at the top of the library, not a sidebar group', () => {
    expect(libraryPageSource).toContain('library-bookmark-toggle');
    expect(libraryPageSource).toContain('🔖');
  });

  it('filters to novels on any shelf and reports its state', () => {
    expect(libraryPageSource).toContain("'aria-pressed': String(bookmarked)");
    expect(libraryPageSource).toContain("filters.shelves = bookmarked ? [] : [...SHELF_IDS]");
  });

  it('drops the callbacks the sidebar no longer wires up', () => {
    expect(libraryPageSource).not.toContain('onToggleShelf');
    expect(libraryPageSource).not.toContain('onToggleTransLang');
  });

  it('is styled, including its active state', () => {
    expect(rule(componentsCss, '.library-bookmark-toggle')).not.toBe('');
    expect(rule(componentsCss, '.library-bookmark-toggle.is-active')).toMatch(/background:/);
  });
});
