/* ════════════════════════════════════════════════════════════════
   Yomi Reader – Main Entry
   ════════════════════════════════════════════════════════════════ */

import './style.css';
import './styles/components.css';
import './styles/platform-redesign.css';
import './styles/admin.css';
import './styles/community.css';
import './styles/mobile.css';
import { router } from './utils/router';
import { loadUserSettings } from './storage';
import { applyTheme, listenForSystemChanges } from './theme';
import { renderLibraryPage } from './pages/LibraryPage';
import { renderNovelPage } from './pages/NovelPage';
import { renderReaderPage, disposeReader } from './pages/ReaderPage';
import { renderAdminPage } from './pages/AdminPage';
import { renderCommunityAdminPage } from './pages/CommunityAdminPage';
import { renderUserProfilePage } from './pages/UserProfilePage';
import {
  clearCommunityCache,
  emitCommunityEvent,
  getCommunityClient,
  isAuthCallbackUrl,
  isCommunityConfigured,
  verifyEmailToken,
} from './community';
import { openAccountDialog } from './components/AuthDialog';
import { initInstallPrompt } from './lib/install-prompt';
import { consumeShareTarget } from './lib/share-target';

let communityInit: Promise<void> | null = null;

/**
 * Starts the optional community service. Missing configuration or a failed
 * SDK load is a no-op here: the library, reader and downloads never depend on
 * it. Supabase's URL/session detection runs before hash routing so auth
 * callbacks (including password recovery) are consumed first.
 */
function initCommunity(): Promise<void> {
  if (communityInit) return communityInit;
  communityInit = (async () => {
    if (!isCommunityConfigured()) return;
    const client = await getCommunityClient();
    if (!client) return;

    client.auth.onAuthStateChange((event) => {
      clearCommunityCache();
      emitCommunityEvent('auth');
      if (event === 'PASSWORD_RECOVERY') openAccountDialog('recovery');
    });

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    if (tokenHash && type) {
      try {
        await verifyEmailToken(tokenHash, type);
        if (type === 'recovery') openAccountDialog('recovery');
      } catch (error) {
        console.warn('Yomi could not confirm that email link.', error);
      } finally {
        history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    }
  })();
  return communityInit;
}

async function boot(): Promise<void> {
  const settings = await loadUserSettings();
  applyTheme(settings.theme);

  listenForSystemChanges(() => {
    loadUserSettings().then(s => {
      if (s.theme === 'system') applyTheme('system');
    });
  });

  const app = document.getElementById('app')!;

  // Capture the PWA install prompt and any inbound Web Share Target content
  // before routing, so a shared link opens the Add-book page directly.
  initInstallPrompt();
  const shared = consumeShareTarget();
  if (shared) window.location.hash = 'admin';

  // Auth callbacks must be consumed before the hash router reads the URL.
  if (isAuthCallbackUrl()) await initCommunity();

  router.on('library', async (params) => {
    disposeReader(app);
    await renderLibraryPage(app, params.search ?? '', params.bookmarked === '1');
  });

  router.on('novel/:id', async (params) => {
    disposeReader(app);
    await renderNovelPage(app, params.id);
  });

  router.on('reader/:novelId/:chapterId?', async (params) => {
    await renderReaderPage(app, params.novelId, params.chapterId);
  });

  router.on('admin', async () => {
    disposeReader(app);
    await renderAdminPage(app);
  });

  router.on('community-admin', async () => {
    disposeReader(app);
    await renderCommunityAdminPage(app);
  });

  router.on('user/:username', async (params) => {
    disposeReader(app);
    await renderUserProfilePage(app, params.username);
  });

  router.start();

  void initCommunity();

  // The reader must be ready before background PWA setup begins. Registration
  // is intentionally production-only and never participates in app startup.
  if (import.meta.env.PROD && (location.protocol === 'http:' || location.protocol === 'https:') && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.warn('Yomi offline support could not be enabled.', error));
  }
}

boot().catch(console.error);
