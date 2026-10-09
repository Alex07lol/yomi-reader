/* ─── Download Panel Component ───
   Handles complete EPUB and per-volume downloads
   for multi-novel support.
*/

import { el, empty } from '../utils/dom';
import type { Download, Volume } from '../models';

export function renderDownloadPanel(
  container: HTMLElement,
  downloads: Download[],
  volumes: Volume[],
): void {
  empty(container);

  if (downloads.length === 0) {
    container.appendChild(
      el('p', { className: 'download-empty', text: 'No downloads available for this novel yet.' }),
    );
    return;
  }

  const panel = el('div', { className: 'download-panel' });

  const completeDownloads = downloads.filter(d => d.type === 'complete');
  const volumeDownloads = downloads.filter(d => d.type === 'volume');

  if (completeDownloads.length > 0) {
    panel.appendChild(
      el('div', { className: 'download-section' },
        el('h4', { className: 'download-section-title', text: 'Complete Novel' }),
        ...completeDownloads.map(d =>
          el('a', {
            className: 'download-link',
            href: d.url,
            download: true,
          },
            el('span', { text: d.label }),
            el('span', { className: 'download-size', text: formatSize(d.size) }),
          ),
        ),
      ),
    );
  }

  if (volumeDownloads.length > 0) {
    const sorted = [...volumeDownloads].sort((a, b) => {
      const va = volumes.find(v => v.id === a.volumeId);
      const vb = volumes.find(v => v.id === b.volumeId);
      return (va?.volumeNumber ?? 0) - (vb?.volumeNumber ?? 0);
    });

    panel.appendChild(
      el('div', { className: 'download-section' },
        el('h4', { className: 'download-section-title', text: 'Volumes' }),
        ...sorted.map(d => {
          const vol = volumes.find(v => v.id === d.volumeId);
          return el('a', {
            className: 'download-link',
            href: d.url,
            download: true,
          },
            el('span', { text: d.label || (vol ? `Volume ${vol.volumeNumber}` : 'Volume') }),
            el('span', { className: 'download-size', text: formatSize(d.size) }),
          );
        }),
      ),
    );
  }

  container.appendChild(panel);
}

function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}