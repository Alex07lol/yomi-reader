/* ─── "Install app" navbar button ───
   Only rendered when the browser offers an install prompt and the app is not
   already running standalone. */

import { el, empty } from '../utils/dom';
import { installPrompt, type InstallAvailability } from '../lib/install-prompt';

const mounted = new Set<HTMLElement>();
let subscribed = false;

function paint(container: HTMLElement, availability: InstallAvailability): void {
  if (!container.isConnected) {
    mounted.delete(container);
    return;
  }
  empty(container);
  if (availability !== 'available') return;

  const button = el('button', {
    className: 'navbar-install-button',
    type: 'button',
    'aria-label': 'Install the Yomi app',
    title: 'Install the Yomi app',
    onclick: async () => {
      button.disabled = true;
      await installPrompt.promptInstall();
      button.disabled = false;
    },
  },
    // On narrow phones CSS hides the label and keeps the icon, so the affordance
    // stays available without squeezing the navbar.
    el('span', { className: 'navbar-install-icon', 'aria-hidden': 'true', text: '\u2913' }),
    el('span', { className: 'navbar-install-label', text: 'Install app' }),
  );
  container.appendChild(button);
}

export function renderInstallButton(container: HTMLElement): void {
  mounted.add(container);
  if (!subscribed) {
    subscribed = true;
    installPrompt.subscribe(() => {
      for (const target of [...mounted]) paint(target, installPrompt.getAvailability());
    });
  }
  paint(container, installPrompt.getAvailability());
}
