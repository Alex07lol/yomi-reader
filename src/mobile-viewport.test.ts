/*
 * Guards the mobile/PWA wiring. These are static contracts (viewport meta,
 * safe-area CSS, sheet breakpoints, share target) that are easy to drop in a
 * refactor and hard to notice until someone opens the site on a phone.
 */

import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import manifestRaw from '../public/manifest.webmanifest?raw';
import mobileCss from './styles/mobile.css?raw';
import mainSource from './main.ts?raw';
import installButtonSource from './components/InstallButton.ts?raw';

const manifest = JSON.parse(manifestRaw) as {
  display: string;
  start_url: string;
  theme_color: string;
  share_target?: { method: string; action: string; params: Record<string, string> };
};

describe('mobile viewport', () => {
  it('opts into the full screen on notched devices', () => {
    expect(indexHtml).toContain('viewport-fit=cover');
    expect(indexHtml).toContain('width=device-width');
    expect(indexHtml).toContain('initial-scale=1.0');
  });

  it('keeps the layout stable when a mobile keyboard opens', () => {
    expect(indexHtml).toContain('interactive-widget=resizes-content');
  });

  it('declares the installable web-app metadata', () => {
    expect(indexHtml).toContain('name="mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(indexHtml).toContain('name="theme-color"');
    expect(indexHtml).toContain('rel="manifest"');
  });
});

describe('mobile stylesheet', () => {
  it('is loaded last so it can refine the desktop layout', () => {
    const community = mainSource.indexOf("styles/community.css");
    const mobile = mainSource.indexOf("styles/mobile.css");
    expect(community).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(community);
  });

  it('respects device safe areas', () => {
    expect(mobileCss).toContain('env(safe-area-inset-top');
    expect(mobileCss).toContain('env(safe-area-inset-bottom');
    expect(mobileCss).toContain('env(safe-area-inset-left');
    expect(mobileCss).toContain('env(safe-area-inset-right');
  });

  it('uses dynamic viewport height for the reader', () => {
    expect(mobileCss).toMatch(/\.reader-main\s*\{[^}]*height:\s*100dvh/);
  });

  it('turns the floating panels into bottom sheets on phones', () => {
    expect(mobileCss).toMatch(/@media \(max-width: 768px\)/);
    for (const selector of ['.reader-search-panel', '.reader-settings-panel', '.community-notification-panel']) {
      const block = mobileCss.slice(mobileCss.indexOf(selector));
      expect(block).toContain('bottom: 0');
      expect(block).toContain('position: fixed');
    }
  });

  it('raises tap targets and removes sticky hover on touch devices', () => {
    expect(mobileCss).toContain('@media (pointer: coarse)');
    expect(mobileCss).toContain('--tap-target: 44px');
    expect(mobileCss).toContain('touch-action: manipulation');
    expect(mobileCss).toContain('@media (hover: none)');
  });

  it('keeps safe-area padding accessible to other stylesheets', () => {
    expect(mobileCss).toContain('--safe-bottom');
  });

  it('contains sheet scrolling instead of chaining it to the chapter', () => {
    for (const selector of ['.reader-search-panel', '.reader-settings-panel', '.community-notification-panel']) {
      const block = mobileCss.slice(mobileCss.indexOf(selector, mobileCss.indexOf('Bottom-sheet affordances')));
      expect(block).toContain('overscroll-behavior: contain');
    }
  });

  it('gives every bottom sheet a grab affordance', () => {
    const sheetSection = mobileCss.slice(mobileCss.indexOf('Bottom-sheet affordances'));
    for (const selector of ['.reader-search-panel::before', '.reader-settings-panel::before', '.community-notification-panel::before']) {
      expect(sheetSection).toContain(selector);
    }
  });

  it('stops sideways panning without breaking the sticky navbar', () => {
    // `overflow-x: hidden` on <body> would make it a scroll container and break
    // position: sticky; `clip` suppresses the overflow without that side effect.
    expect(mobileCss).toMatch(/body \{[^}]*overflow-x:\s*clip/s);
    expect(mobileCss).not.toMatch(/body \{[^}]*overflow-x:\s*hidden/s);
  });
});

describe('mobile install affordance', () => {
  it('ships an icon and a label so phones can hide the text', () => {
    expect(installButtonSource).toContain('navbar-install-icon');
    expect(installButtonSource).toContain('navbar-install-label');
    // The label is what the <=480px rule hides; the icon must stay visible.
    expect(mobileCss).toMatch(/\.navbar-install-label\s*\{[^}]*display:\s*none/);
  });
});

describe('installable app manifest', () => {
  it('runs standalone from the library route', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/#library');
    expect(manifest.theme_color).toBe('#171c26');
  });

  it('receives shared links', () => {
    expect(manifest.share_target?.method).toBe('GET');
    expect(manifest.share_target?.action).toBe('/');
    expect(manifest.share_target?.params).toEqual({ title: 'title', text: 'text', url: 'url' });
  });
});
