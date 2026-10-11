/* ─── Chrome and library contracts ───
   jsdom has no layout, so the dialog centring bug cannot be reproduced in a
   rendered test. The guards below pin the rules and markup that made the fixes
   work, following the raw-source contract tests already used for the mobile
   viewport. */

import { describe, expect, it } from 'vitest';
import communityCss from './styles/community.css?raw';
import componentsCss from './styles/components.css?raw';
import mobileCss from './styles/mobile.css?raw';
import styleCss from './style.css?raw';
import filtersSource from './components/LibraryFilters.ts?raw';
import libraryPageSource from './pages/LibraryPage.ts?raw';
import navbarSource from './components/Navbar.ts?raw';
import topMenuSource from './components/TopMenu.ts?raw';
import iconsSource from './components/icons.ts?raw';
import bellSource from './components/NotificationBell.ts?raw';
import routerSource from './utils/router.ts?raw';

/** The text of a single `selector { … }` rule, so assertions stay scoped to it.
    Comments are stripped first: a `}` inside one would truncate the block. */
function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(`${selector} {`);
  return start === -1 ? '' : clean.slice(start, clean.indexOf('}', start));
}

const PICTOGRAPHS = /[\u{1F000}-\u{1FAFF}]/u;

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

describe('top-right menu', () => {
  it('is a single control, replacing the separate theme and account ones', () => {
    expect(navbarSource).toContain('navbar-menu-container');
    // The exact wiring, so a rename in one place cannot silently orphan the menu.
    expect(navbarSource).toContain("renderTopMenu(nav.querySelector('.navbar-menu-container')!)");
    expect(navbarSource).not.toContain('navbar-theme-container');
    expect(navbarSource).not.toContain('navbar-account-container');
    expect(navbarSource).not.toContain('renderThemeSelector');
    expect(navbarSource).not.toContain('renderAccountMenu');
  });

  it('holds account, appearance and bookmarks together', () => {
    expect(topMenuSource).toContain("'Sign in'");
    expect(topMenuSource).toContain("'Create account'");
    expect(topMenuSource).toContain("label: 'OLED Black'");
    expect(topMenuSource).toContain("'Bookmarked novels'");
    expect(topMenuSource).toContain('router.navigate(\'library?bookmarked=1\')');
  });

  it('is labelled and exposes its expanded state', () => {
    expect(topMenuSource).toContain("'aria-haspopup': 'menu'");
    expect(topMenuSource).toContain("'aria-expanded': 'false'");
    expect(topMenuSource).toContain("'aria-label': 'Account, appearance and bookmarks'");
  });

  it('is styled as a compact dropdown, including the active theme row', () => {
    expect(rule(communityCss, '.top-menu-trigger')).not.toBe('');
    expect(rule(communityCss, '.top-menu-item.is-active')).toMatch(/color:/);

    const panel = rule(communityCss, '.top-menu-panel');
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/width:\s*min\(208px/);
  });

  it('hangs below its trigger rather than upward from the bottom of the screen', () => {
    // The reported bug: a width-scoped rule pinned it to the viewport bottom, which
    // reads as the menu opening upwards.
    const panel = rule(communityCss, '.top-menu-panel');
    expect(panel).toMatch(/top:\s*calc\(100% \+ 6px\)/);
    expect(panel).toMatch(/bottom:\s*auto/);
    expect(mobileCss).not.toContain('.top-menu-panel');
  });

  it('opens as a sheet on phones, and leaves no dead theme/account CSS behind', () => {
    expect(communityCss).not.toContain('.community-account-menu');
    expect(communityCss).not.toContain('.navbar-account-container');
    expect(componentsCss).not.toContain('.theme-selector');
    expect(componentsCss).not.toContain('.library-bookmark-toggle');
  });
});

describe('bookmarks entry point', () => {
  it('filters the library from the URL flag rather than a toolbar pill', () => {
    expect(libraryPageSource).toContain('initialBookmarked');
    expect(libraryPageSource).toContain('shelves: initialBookmarked ? [...SHELF_IDS] : []');
    expect(libraryPageSource).not.toContain('library-bookmark-toggle');
    expect(routerSource).toContain("queryParams.get('bookmarked')");
  });
});

describe('monochrome chrome', () => {
  it('draws icons in SVG with currentColor instead of shipping emoji', () => {
    expect(iconsSource).toContain("createElementNS(SVG_NS, 'svg')");
    expect(iconsSource).toContain("setAttribute('stroke', 'currentColor')");
    expect(bellSource).toContain('bellIcon(');
  });

  it('has no pictographic emoji left in the navbar, menu, bell or library', () => {
    for (const [name, source] of Object.entries({
      Navbar: navbarSource,
      TopMenu: topMenuSource,
      NotificationBell: bellSource,
      LibraryPage: libraryPageSource,
      icons: iconsSource,
    })) {
      expect(PICTOGRAPHS.test(source), `${name} still contains an emoji`).toBe(false);
    }
  });
});
