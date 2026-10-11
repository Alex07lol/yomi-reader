/* ─── Community moderation page ───
   Owner-only. Access is decided in the database through RLS + the
   is_community_moderator() helper; the UI only reflects what the server
   already allows. A username or client flag can never grant access. */

import { el, empty } from '../utils/dom';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import { renderNavbar, renderFooter } from '../components';
import { openAccountDialog } from '../components/AuthDialog';
import {
  getCurrentUser,
  isCommunityConfigured,
  isModerator,
  listPendingReports,
  reviewReport,
  setCommentVisibility,
  setUserRestriction,
} from '../community';
import type { ModerationReport, ReportReason, ReportStatus } from '../community';
import { REPORT_REASONS } from '../community';

const REASON_LABELS = new Map(REPORT_REASONS.map((reason) => [reason.value, reason.label]));

function reasonLabel(reason: ReportReason): string {
  return REASON_LABELS.get(reason) ?? reason;
}

export async function renderCommunityAdminPage(container: HTMLElement): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-community-admin' });
  const navbarContainer = el('div', { className: 'navbar-container' });
  const main = el('main', { className: 'main-content community-admin-main' });
  const footerContainer = el('div', { className: 'footer-container' });
  page.appendChild(navbarContainer);
  page.appendChild(main);
  page.appendChild(footerContainer);
  container.appendChild(page);

  renderNavbar(navbarContainer, 'community-admin');
  renderFooter(footerContainer);

  const panel = el('section', { className: 'community-admin' });
  main.appendChild(panel);

  if (!isCommunityConfigured()) {
    panel.appendChild(el('div', { className: 'community-admin-gate' },
      el('h1', { text: 'Moderation' }),
      el('p', { text: 'Community features are not configured for this deployment.' }),
    ));
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    panel.appendChild(el('div', { className: 'community-admin-gate' },
      el('h1', { text: 'Moderation' }),
      el('p', { text: 'Sign in with a moderator account to review reports.' }),
      el('button', {
        className: 'community-button community-button-primary',
        type: 'button',
        text: 'Sign in',
        onclick: () => openAccountDialog('sign-in'),
      }),
    ));
    return;
  }

  const moderator = await isModerator();
  if (!moderator) {
    panel.appendChild(el('div', { className: 'community-admin-gate' },
      el('h1', { text: 'Moderation' }),
      el('p', { text: 'This area is limited to moderators. Your account does not have access.' }),
    ));
    return;
  }

  renderQueue(panel);
}

function renderQueue(panel: HTMLElement): void {
  empty(panel);

  let offset = 0;
  let hasMore = false;
  let loading = false;
  let status: ReportStatus = 'pending';

  const listHost = el('div', { className: 'community-admin-list' });
  const statusHost = el('p', { className: 'community-notice', role: 'status', 'aria-live': 'polite' });
  const loadMoreHost = el('div', {});

  const filter = el('select', {
    className: 'community-select',
    'aria-label': 'Report status filter',
    onchange: (event: Event) => {
      status = (event.target as HTMLSelectElement).value as ReportStatus;
      offset = 0;
      void load(true);
    },
  },
    el('option', { value: 'pending', text: 'Pending' }),
    el('option', { value: 'dismissed', text: 'Dismissed' }),
    el('option', { value: 'actioned', text: 'Actioned' }),
  );

  panel.appendChild(el('div', { className: 'community-admin-header' },
    el('div', {},
      el('p', { className: 'eyebrow', text: 'Community' }),
      el('h1', { text: 'Moderation queue' }),
      el('p', { className: 'community-admin-subtitle', text: 'Review reports, hide comments and restrict abusive accounts.' }),
    ),
    filter,
  ));
  panel.appendChild(statusHost);
  panel.appendChild(listHost);
  panel.appendChild(loadMoreHost);

  const setStatus = (text: string, kind: 'error' | 'success' | '' = ''): void => {
    statusHost.className = `community-notice${kind ? ` community-notice-${kind}` : ''}`;
    statusHost.textContent = text;
  };

  const load = async (reset: boolean): Promise<void> => {
    if (loading) return;
    loading = true;
    setStatus(reset ? 'Loading reports…' : 'Loading more…');
    try {
      const page = await listPendingReports(offset, status);
      if (reset) empty(listHost);
      offset = page.nextOffset;
      hasMore = page.hasMore;
      if (reset && page.reports.length === 0) {
        listHost.appendChild(el('p', { className: 'community-empty', text: 'No reports in this view.' }));
      }
      for (const report of page.reports) {
        listHost.appendChild(renderReport(report, refresh));
      }
      renderLoadMore();
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reports could not be loaded.', 'error');
    } finally {
      loading = false;
    }
  };

  const refresh = (): void => {
    offset = 0;
    void load(true);
  };

  function renderLoadMore(): void {
    empty(loadMoreHost);
    if (!hasMore) return;
    loadMoreHost.appendChild(el('button', {
      className: 'community-button community-button-ghost',
      type: 'button',
      text: 'Load more reports',
      onclick: () => void load(false),
    }));
  }

  void load(true);
}

function renderReport(report: ModerationReport, refresh: () => void): HTMLElement {
  const notice = el('p', { className: 'community-notice', role: 'status', 'aria-live': 'polite' });

  const setNotice = (type: 'error' | 'success', text: string): void => {
    notice.className = `community-notice community-notice-${type}`;
    notice.textContent = text;
  };

  const run = async (work: () => Promise<void>, success: string): Promise<void> => {
    try {
      await work();
      setNotice('success', success);
      refresh();
    } catch (error) {
      setNotice('error', error instanceof Error ? error.message : 'The action failed.');
    }
  };

  return el('article', { className: 'community-admin-report' },
    el('div', { className: 'community-admin-report-head' },
      el('span', { className: 'community-admin-reason', text: reasonLabel(report.reason) }),
      el('span', { className: 'community-admin-status', text: report.status }),
      el('time', {
        className: 'community-comment-time',
        datetime: report.createdAt,
        title: formatAbsoluteTime(report.createdAt),
        text: formatRelativeTime(report.createdAt),
      }),
    ),
    el('p', { className: 'community-admin-context' },
      `Reported by ${report.reporterUsername} · in ${report.novelId}`,
      report.chapterId ? ` / ${report.chapterId}` : ' (novel discussion)',
    ),
    report.details ? el('blockquote', { className: 'community-admin-details', text: report.details }) : null,
    el('div', { className: 'community-admin-target' },
      el('span', { className: 'community-admin-target-label', text: `Comment by ${report.commentAuthorUsername}` }),
      el('p', { className: 'community-comment-body', text: report.commentBody }),
      el('span', { className: `community-badge community-badge-${report.commentStatus}`, text: report.commentStatus }),
    ),
    el('div', { className: 'community-admin-actions' },
      report.commentStatus === 'hidden'
        ? el('button', {
            className: 'community-button community-button-ghost',
            type: 'button',
            text: 'Restore comment',
            onclick: () => void run(async () => {
              await setCommentVisibility(report.commentId, 'visible');
              await reviewReport(report.id, 'dismissed');
            }, 'Comment restored.'),
          })
        : el('button', {
            className: 'community-button community-button-ghost',
            type: 'button',
            text: 'Hide comment',
            onclick: () => {
              if (!window.confirm('Hide this comment from readers?')) return;
              void run(async () => {
                await setCommentVisibility(report.commentId, 'hidden');
                await reviewReport(report.id, 'actioned');
              }, 'Comment hidden.');
            },
          }),
      el('button', {
        className: 'community-button community-button-ghost',
        type: 'button',
        text: 'Restrict author',
        onclick: () => {
          const reason = window.prompt('Reason for restricting this account (required):');
          if (!reason || reason.trim().length < 3) return;
          const hoursText = window.prompt('Restrict for how many hours? (blank = indefinite)', '72');
          const hours = hoursText ? Number.parseInt(hoursText, 10) : 72;
          void run(async () => {
            await setUserRestriction(report.commentAuthorId, true, reason.trim(), Number.isFinite(hours) ? hours : 72);
          }, 'Account restricted.');
        },
      }),
      report.status === 'pending' ? el('button', {
        className: 'community-button community-button-ghost',
        type: 'button',
        text: 'Dismiss report',
        onclick: () => void run(async () => {
          await reviewReport(report.id, 'dismissed');
        }, 'Report dismissed.'),
      }) : null,
    ),
    notice,
  );
}
