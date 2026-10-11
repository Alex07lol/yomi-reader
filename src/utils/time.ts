/* ─── Timestamp formatting ─── */

export function formatRelativeTime(input: string | number | Date, now = Date.now()): string {
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((now - then) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 5400) return '1 hr ago';
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  if (seconds < 172800) return 'yesterday';
  if (seconds < 604800) return `${Math.round(seconds / 86400)} days ago`;

  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatAbsoluteTime(input: string | number | Date): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
