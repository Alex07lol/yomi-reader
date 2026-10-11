/* ─── PWA install prompt ───
   Captures the browser's deferred `beforeinstallprompt` event so the app can
   offer its own "Install app" button. Every API is optional and guarded, so an
   unsupported browser (or jsdom in tests) simply reports "unavailable". */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type InstallAvailability = 'unavailable' | 'available' | 'installed';

type Listener = (availability: InstallAvailability) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<Listener>();

function currentAvailability(): InstallAvailability {
  if (installed || isStandalone()) return 'installed';
  return deferredPrompt ? 'available' : 'unavailable';
}

function notify(): void {
  const value = currentAvailability();
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      console.warn('Install availability listener failed.', error);
    }
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  return Boolean((window.navigator as { standalone?: boolean }).standalone);
}

export interface InstallPromptController {
  subscribe(listener: Listener): () => void;
  getAvailability(): InstallAvailability;
  promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

let initialized = false;

/** Installs the global listeners once. Safe to call on every boot. */
export function initInstallPrompt(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export const installPrompt: InstallPromptController = {
  subscribe(listener) {
    initInstallPrompt();
    listeners.add(listener);
    listener(currentAvailability());
    return () => listeners.delete(listener);
  },
  getAvailability: currentAvailability,
  async promptInstall() {
    if (!deferredPrompt) return 'unavailable';
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      notify();
      return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      notify();
      return 'unavailable';
    }
  },
};
