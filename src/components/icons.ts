/* ─── Monochrome icons ───
   Inline SVG drawn with `currentColor`, so every icon follows the active theme
   instead of shipping a coloured emoji. Stroke-based, 24x24 viewBox, matching the
   rest of the UI's line weight. Decorative by default: `aria-hidden` is set here
   and callers label the control itself. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(className: string, paths: string[], size = 20): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('class', className);
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.7');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    node.appendChild(path);
  }
  return node;
}

/** The panel trigger: an account, themes and bookmarks all live behind it. */
export const menuIcon = (className = 'app-icon', size = 20): SVGSVGElement =>
  icon(className, ['M4 7h16', 'M4 12h16', 'M4 17h16'], size);

export const userIcon = (className = 'app-icon', size = 20): SVGSVGElement =>
  icon(className, [
    'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
  ], size);

export const bookmarkIcon = (className = 'app-icon', size = 20): SVGSVGElement =>
  icon(className, ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'], size);

export const appearanceIcon = (className = 'app-icon', size = 20): SVGSVGElement =>
  icon(className, [
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    'M12 2v1.5', 'M12 20.5V22', 'M4.9 4.9l1.1 1.1',
    'M18 18l1.1 1.1', 'M2 12h1.5', 'M20.5 12H22',
    'M4.9 19.1L6 18', 'M18 6l1.1-1.1',
  ], size);

export const checkIcon = (className = 'app-icon', size = 18): SVGSVGElement =>
  icon(className, ['M20 6L9 17l-5-5'], size);

export const bellIcon = (className = 'app-icon', size = 20): SVGSVGElement =>
  icon(className, [
    'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9',
    'M13.7 21a2 2 0 0 1-3.4 0',
  ], size);
