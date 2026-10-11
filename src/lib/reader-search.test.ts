import { describe, expect, it } from 'vitest';
import {
  SEARCH_HIT_CLASS,
  activateMatch,
  buildSnippet,
  clearSearchHighlights,
  findTextMatches,
  highlightMatches,
  searchChapters,
  stripHtml,
} from './reader-search';

const chapters = [
  { id: 'c1', globalChapterNumber: 1, title: 'Arrival', content: '<p>The dragon <em>arrived</em> at dawn.</p>' },
  { id: 'c2', globalChapterNumber: 2, title: 'The dragon again', content: '<p>Nothing to see.</p>' },
  { id: 'c3', globalChapterNumber: 3, title: 'Dusk', content: '<p>Another dragon, and a <strong>dragon</strong>.</p>' },
];

describe('stripHtml', () => {
  it('removes tags, scripts and entities', () => {
    expect(stripHtml('<p>Hello&nbsp;<em>there</em></p><script>bad()</script>')).toBe('Hello there');
    expect(stripHtml('<style>p{}</style>Text &amp; more')).toBe('Text & more');
  });
});

describe('findTextMatches', () => {
  it('finds case-insensitive, non-overlapping matches', () => {
    expect(findTextMatches('Dragon dragon DRAGON', 'dragon')).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 },
      { start: 14, end: 20 },
    ]);
  });

  it('returns nothing for a blank query', () => {
    expect(findTextMatches('abc', '   ')).toEqual([]);
  });

  it('treats regex characters literally', () => {
    expect(findTextMatches('a+b a+b', 'a+b')).toHaveLength(2);
  });

  it('honours the limit', () => {
    expect(findTextMatches('x x x x', 'x', 2)).toHaveLength(2);
  });
});

describe('buildSnippet', () => {
  it('trims around the match and adds ellipses', () => {
    const text = `${'a'.repeat(200)}NEEDLE${'b'.repeat(200)}`;
    const snippet = buildSnippet(text, { start: 200, end: 206 }, 10);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('NEEDLE');
  });
});

describe('searchChapters', () => {
  it('returns one row per matching chapter with counts and a snippet', () => {
    const results = searchChapters(chapters, 'dragon');
    expect(results.map(r => r.chapterId)).toEqual(['c1', 'c3']);
    expect(results[0].matchCount).toBe(1);
    expect(results[1].matchCount).toBe(2);
    expect(results[1].snippet).toContain('dragon');
  });

  it('is case-insensitive and returns nothing for blank queries', () => {
    expect(searchChapters(chapters, 'DRAGON')).toHaveLength(2);
    expect(searchChapters(chapters, '   ')).toEqual([]);
  });
});

describe('DOM highlighting', () => {
  function mount(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it('wraps text-node matches without touching markup', () => {
    const root = mount('<p>The <em>dragon</em> met a dragon.</p>');
    const marks = highlightMatches(root, 'dragon');
    expect(marks).toHaveLength(2);
    expect(marks[0].tagName).toBe('MARK');
    expect(marks[0].classList.contains(SEARCH_HIT_CLASS)).toBe(true);
    // The <em> element survives untouched.
    expect(root.querySelector('em')?.textContent).toBe('dragon');
    expect(root.textContent).toBe('The dragon met a dragon.');
  });

  it('does not highlight inside an existing mark', () => {
    const root = mount('<p>dragon</p>');
    highlightMatches(root, 'dragon');
    const marks = highlightMatches(root, 'drag');
    expect(marks).toHaveLength(1);
    expect(root.querySelectorAll('mark').length).toBe(1);
  });

  it('clears highlights and restores the text', () => {
    const root = mount('<p>a<span>dragon</span>b</p>');
    highlightMatches(root, 'dragon');
    expect(root.querySelectorAll('mark').length).toBe(1);
    clearSearchHighlights(root);
    expect(root.querySelectorAll('mark').length).toBe(0);
    expect(root.textContent).toBe('adragonb');
  });

  it('activates a match and wraps around', () => {
    const root = mount('<p>dragon dragon dragon</p>');
    const marks = highlightMatches(root, 'dragon');
    expect(activateMatch(marks, 0)).toBe(0);
    expect(marks[0].classList.contains('is-active')).toBe(true);
    expect(activateMatch(marks, 3)).toBe(0);
    expect(activateMatch(marks, -1)).toBe(2);
    expect(marks[2].classList.contains('is-active')).toBe(true);
    expect(marks[0].classList.contains('is-active')).toBe(false);
  });
});
