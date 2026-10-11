/* ─── Public user profile ───
   Shows a reader's avatar, join date, visible activity counts and their public
   comments and reviews with the upvotes each received. Everything here is
   read-only and RLS-filtered: only visible posts are ever listed. */

import { el, empty } from '../utils/dom';
import { router } from '../utils/router';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import {
  avatarUrl,
  getProfileByUsername,
  getProfileStats,
  isCommunityConfigured,
  listUserComments,
} from '../community';
import type { CommunityComment, CommunityProfile, ProfileActivitySummary } from '../community';
import { renderNavbar } from '../components/Navbar';
import { renderFooter } from '../components/Footer';

export async function renderUserProfilePage(container: HTMLElement, username: string): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-profile' });
  const navbarContainer = el('div', { className: 'navbar-container' });
  const main = el('main', { className: 'main-content profile-main' });
  const footerContainer = el('div', { className: 'footer-container' });
  page.appendChild(navbarContainer);
  page.appendChild(main);
  page.appendChild(footerContainer);
  container.appendChild(page);

  renderNavbar(navbarContainer, 'profile');
  renderFooter(footerContainer);

  if (!isCommunityConfigured()) {
    main.appendChild(el('div', { className: 'community-empty' },
      el('p', { text: 'Community profiles are not configured for this deployment.' }),
    ));
    return;
  }

  main.appendChild(el('div', { className: 'loading', text: 'Loading profile…' }));

  let profile: CommunityProfile | null;
  try {
    profile = await getProfileByUsername(username);
  } catch {
    profile = null;
  }
  empty(main);

  if (!profile) {
    main.appendChild(el('section', { className: 'profile-card profile-card-missing' },
      el('h1', { className: 'profile-username', text: `@${username}` }),
      el('p', { className: 'profile-missing-text', text: 'This reader could not be found.' }),
      backToLibraryButton(),
    ));
    return;
  }

  const stats = await getProfileStats(profile.id);
  main.appendChild(renderProfileHeader(profile, stats));

  const activitySection = el('section', { className: 'profile-activity', 'aria-label': 'Comments and reviews' });
  activitySection.appendChild(el('h2', { className: 'profile-section-title', text: 'Comments & reviews' }));
  const listHost = el('div', { className: 'profile-activity-list', role: 'status', 'aria-live': 'polite' });
  activitySection.appendChild(listHost);
  main.appendChild(activitySection);

  listHost.appendChild(el('div', { className: 'community-skeleton', 'aria-hidden': 'true' },
    el('span', { className: 'community-skeleton-row' }),
    el('span', { className: 'community-skeleton-row' }),
  ));

  let offset = 0;
  let busy = false;

  const load = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const pageResult = await listUserComments(profile!.id, offset);
      if (offset === 0) empty(listHost);
      if (offset === 0 && pageResult.comments.length === 0) {
        listHost.appendChild(el('p', { className: 'community-empty', text: 'No public comments yet.' }));
      }
      for (const comment of pageResult.comments) {
        listHost.appendChild(renderActivityItem(comment));
      }
      offset = pageResult.nextOffset;
      if (pageResult.hasMore) {
        listHost.appendChild(el('button', {
          className: 'community-button community-button-ghost community-load-more',
          type: 'button',
          text: 'Load more',
          onclick: (event: Event) => {
            (event.currentTarget as HTMLButtonElement).remove();
            void load();
          },
        }));
      }
    } catch (error) {
      if (offset === 0) {
        empty(listHost);
        listHost.appendChild(el('p', {
          className: 'community-empty community-empty-error',
          text: error instanceof Error ? error.message : 'This activity could not be loaded.',
        }));
      }
    } finally {
      busy = false;
    }
  };

  await load();
}

function backToLibraryButton(): HTMLElement {
  return el('button', {
    className: 'btn btn-secondary',
    type: 'button',
    text: 'Back to library',
    onclick: () => router.navigate('library'),
  });
}

function renderProfileHeader(profile: CommunityProfile, stats: ProfileActivitySummary): HTMLElement {
  const url = avatarUrl(profile.avatarPath);
  const avatar = el('div', { className: 'profile-avatar community-avatar community-avatar-lg' },
    url
      ? el('img', { src: url, alt: '', referrerpolicy: 'no-referrer' })
      : el('span', { className: 'profile-avatar-fallback', 'aria-hidden': 'true', text: profile.username.slice(0, 2).toUpperCase() }),
  );

  const totalComments = stats.chapterCommentCount + stats.novelCommentCount;

  return el('section', { className: 'profile-card' },
    avatar,
    el('div', { className: 'profile-identity' },
      el('h1', { className: 'profile-username', text: `@${profile.username}` }),
      el('p', {
        className: 'profile-joined',
        text: `Joined ${new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
      }),
      el('div', { className: 'profile-stats' },
        statChip(String(stats.reviewCount), stats.reviewCount === 1 ? 'review' : 'reviews'),
        statChip(String(totalComments), totalComments === 1 ? 'comment' : 'comments'),
        statChip(String(stats.likesReceived), 'upvotes received'),
      ),
    ),
  );
}

function statChip(value: string, label: string): HTMLElement {
  return el('div', { className: 'profile-stat' },
    el('span', { className: 'profile-stat-value', text: value }),
    el('span', { className: 'profile-stat-label', text: label }),
  );
}

function renderActivityItem(comment: CommunityComment): HTMLElement {
  const kindLabel = comment.kind === 'review'
    ? (comment.rating !== null ? `Review · ${'★'.repeat(comment.rating)}` : 'Review')
    : (comment.chapterId ? 'Chapter comment' : 'Novel comment');

  return el('article', { className: 'profile-activity-item' },
    el('div', { className: 'profile-activity-meta' },
      el('span', { className: 'profile-activity-kind', text: kindLabel }),
      el('time', {
        className: 'community-comment-time',
        datetime: comment.createdAt,
        title: formatAbsoluteTime(comment.createdAt),
        text: formatRelativeTime(comment.createdAt),
      }),
      el('span', { className: 'profile-activity-likes', 'aria-label': `${comment.likeCount} upvotes` },
        el('span', { 'aria-hidden': 'true', text: '♥' }),
        el('span', { text: String(comment.likeCount) }),
      ),
    ),
    el('p', { className: 'profile-activity-body', text: comment.body }),
    el('button', {
      className: 'profile-activity-link',
      type: 'button',
      text: 'View in discussion →',
      onclick: () => router.navigate(`novel/${comment.novelId}`),
    }),
  );
}
