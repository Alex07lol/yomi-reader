/* ─── In-reader search ───
   Two layers that share one query grammar:

   * pure text helpers that index chapter HTML and build result snippets, and
   * DOM helpers that wrap matches in <mark> elements inside already-rendered
     chapter text.

   Matches are found only in text nodes, so a search can never break the chapter
   markup or highlight inside a tag. Everything is synchronous and local — no
   server, no index to build. */

export const SEARCH_HIT_CLASS = 'reader-search-hit';

export interface TextMatch {
  start: number;
  end: number;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Plain, readable text from chapter HTML, with tags and entities resolved. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case-insensitive, non-overlapping matches of `query` in `text`. */
export function findTextMatches(text: string, query: string, limit = 1000): TextMatch[] {
  const needle = query.trim();
  if (!needle || !text) return [];
  const pattern = new RegExp(escapeRegExp(needle), 'gi');
  const matches: TextMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) pattern.lastIndex += 1;
    if (matches.length >= limit) break;
  }
  return matches;
}

/** A one-line excerpt around one match, with leading/trailing ellipses. */
export function buildSnippet(text: string, match: TextMatch, radius = 70): string {
  const start = Math.max(0, match.start - radius);
  const end = Math.min(text.length, match.end + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export interface SearchableChapter {
  id: string;
  globalChapterNumber: number;
  title: string;
  content: string;
}

export interface NovelSearchResult {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  snippet: string;
  matchCount: number;
  /** Index of the representative match within that chapter, for jump-to-match. */
  matchIndex: number;
}

/** Searches a whole novel, returning one row per matching chapter. */
export function searchChapters(
  chapters: SearchableChapter[],
  query: string,
  limit = 100,
): NovelSearchResult[] {
  const needle = query.trim();
  if (!needle) return [];
  const results: NovelSearchResult[] = [];
  for (const chapter of chapters) {
    const text = stripHtml(chapter.content);
    const matches = findTextMatches(text, needle);
    if (matches.length === 0) continue;
    results.push({
      chapterId: chapter.id,
      chapterNumber: chapter.globalChapterNumber,
      chapterTitle: chapter.title || `Chapter ${chapter.globalChapterNumber}`,
      snippet: buildSnippet(text, matches[0]),
      matchCount: matches.length,
      matchIndex: 0,
    });
    if (results.length >= limit) break;
  }
  return results;
}

/* ── DOM highlighting ── */

function isSkippable(parent: Element | null): boolean {
  if (!parent) return true;
  const tag = parent.tagName;
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'MARK';
}

/** Removes every search highlight, merging the split text nodes back together. */
export function clearSearchHighlights(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(`mark.${SEARCH_HIT_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
}

/**
 * Wraps every occurrence of `query` inside `root` in `<mark class="reader-search-hit">`
 * and returns the marks in document order. Only text nodes are touched.
 */
export function highlightMatches(root: ParentNode, query: string, limit = 1000): HTMLElement[] {
  clearSearchHighlights(root);
  const needle = query.trim();
  const marks: HTMLElement[] = [];
  if (!needle || typeof document === 'undefined') return marks;

  const ownerDocument = (root as Node).ownerDocument ?? document;
  const pattern = new RegExp(escapeRegExp(needle), 'gi');

  const textNodes: Text[] = [];
  const walker = ownerDocument.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ?? '';
      if (!text.trim() || isSkippable((node as Text).parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current: Node | null = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  outer: for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;

    const fragment = ownerDocument.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(ownerDocument.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark = ownerDocument.createElement('mark');
      mark.className = SEARCH_HIT_CLASS;
      mark.textContent = match[0];
      fragment.appendChild(mark);
      marks.push(mark);
      lastIndex = match.index + match[0].length;
      if (marks.length >= limit) break;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(ownerDocument.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
    if (marks.length >= limit) break outer;
  }

  return marks;
}

/** Marks one highlight as active and scrolls it into view. */
export function activateMatch(marks: HTMLElement[], index: number): number {
  if (marks.length === 0) return -1;
  const safe = ((index % marks.length) + marks.length) % marks.length;
  marks.forEach((mark, i) => mark.classList.toggle('is-active', i === safe));
  // jsdom and some embedded webviews omit scrollIntoView; highlighting still works.
  if (typeof marks[safe].scrollIntoView === 'function') {
    marks[safe].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return safe;
}
