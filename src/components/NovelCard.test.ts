import { describe, expect, it } from 'vitest';
import { applyNovelCardRating, renderNovelCard } from './NovelCard';
import type { Novel } from '../models';

function novel(overrides: Partial<Novel> = {}): Novel {
  return {
    id: 'novel-1',
    title: 'Test Novel',
    originalTitle: '',
    alternativeTitles: [],
    author: 'Author',
    description: 'A description.',
    cover: '',
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    status: 'ongoing',
    genres: [],
    tags: [],
    volumes: [],
    chapters: [],
    downloads: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('novel card rating badge', () => {
  it('stays hidden until a rating is applied', () => {
    const card = renderNovelCard(novel());
    const badge = card.querySelector<HTMLElement>('.novel-card-rating');
    expect(badge?.hidden).toBe(true);
  });

  it('shows the average, stars and review count', () => {
    const card = renderNovelCard(novel());
    applyNovelCardRating(card, { novelId: 'novel-1', average: 4.5, count: 12 });
    const badge = card.querySelector<HTMLElement>('.novel-card-rating');
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toContain('4.5');
    expect(badge?.textContent).toContain('(12)');
    expect(badge?.textContent).toContain('★');
    expect(badge?.getAttribute('aria-label')).toContain('4.5 out of 5');
  });

  it('hides again for zero-review novels', () => {
    const card = renderNovelCard(novel());
    applyNovelCardRating(card, { novelId: 'novel-1', average: null, count: 0 });
    expect(card.querySelector<HTMLElement>('.novel-card-rating')?.hidden).toBe(true);
  });
});
