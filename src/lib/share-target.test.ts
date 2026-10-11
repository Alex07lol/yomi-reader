import { describe, expect, it } from 'vitest';
import { normalizeSharedUrl, parseShareParams } from './share-target';

describe('share target parsing', () => {
  it('reads title, text and url', () => {
    expect(parseShareParams('?title=Overlord&url=https%3A%2F%2Fexample.com%2Fb')).toEqual({
      title: 'Overlord',
      text: null,
      url: 'https://example.com/b',
    });
  });

  it('returns null when nothing was shared', () => {
    expect(parseShareParams('')).toBeNull();
    expect(parseShareParams('?q=reader')).toBeNull();
    expect(parseShareParams('?title=%20%20')).toBeNull();
  });

  it('caps absurdly long values', () => {
    expect(parseShareParams(`?text=${'a'.repeat(5000)}`)?.text?.length).toBe(2000);
  });
});

describe('shared link safety', () => {
  it('accepts only http(s) urls', () => {
    expect(normalizeSharedUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(normalizeSharedUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeSharedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSharedUrl('data:text/html,<script>')).toBeNull();
    expect(normalizeSharedUrl('not a url')).toBeNull();
    expect(normalizeSharedUrl(null)).toBeNull();
  });
});
