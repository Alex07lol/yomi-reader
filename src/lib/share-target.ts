/* ─── Web Share Target ───
   The manifest registers Yomi as a share target, so a link shared from another
   app opens `/?title=…&text=…&url=…`. We read those once at boot, strip them
   from the URL, and hand the content to the Add-book page.

   Only `http(s)` links are ever treated as openable; anything else is shown as
   plain, inert text. */

export interface SharedContent {
  title: string | null;
  text: string | null;
  url: string | null;
}

const SHARE_KEYS = ['title', 'text', 'url'] as const;

function clean(value: string | null, max = 2000): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** A safe, absolute link if the shared value is an http(s) URL. */
export function normalizeSharedUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function parseShareParams(search: string): SharedContent | null {
  const params = new URLSearchParams(search);
  const title = clean(params.get('title'));
  const text = clean(params.get('text'));
  const url = clean(params.get('url'));
  if (!title && !text && !url) return null;
  return { title, text, url };
}

let pending: SharedContent | null = null;

/**
 * Reads share parameters from the current URL (once) and removes them so a
 * reload does not re-open the same shared link. Returns the parsed content.
 */
export function consumeShareTarget(search = window.location.search): SharedContent | null {
  const parsed = parseShareParams(search);
  if (!parsed) return null;
  pending = parsed;
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of SHARE_KEYS) params.delete(key);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    history.replaceState(null, '', next);
  } catch {
    // History may be unavailable in a sandboxed embedding; the content is kept.
  }
  return parsed;
}

/** Returns and clears the shared content for the Add-book page to render. */
export function takeSharedContent(): SharedContent | null {
  const value = pending;
  pending = null;
  return value;
}
