/* ════════════════════════════════════════════════════════════════
   Yomi Reader – Main Entry
   ════════════════════════════════════════════════════════════════ */

import './style.css';
import './styles/components.css';
import './styles/platform-redesign.css';
import './styles/admin.css';
import { router } from './utils/router';
import { loadUserSettings } from './storage';
import { applyTheme, listenForSystemChanges } from './theme';
import { renderLibraryPage } from './pages/LibraryPage';
import { renderNovelPage } from './pages/NovelPage';
import { renderReaderPage, disposeReader } from './pages/ReaderPage';
import { renderAdminPage } from './pages/AdminPage';

async function boot(): Promise<void> {
  const settings = await loadUserSettings();
  applyTheme(settings.theme);

  listenForSystemChanges(() => {
    loadUserSettings().then(s => {
      if (s.theme === 'system') applyTheme('system');
    });
  });

  const app = document.getElementById('app')!;

  router.on('library', async (params) => {
    disposeReader(app);
    await renderLibraryPage(app, params.search ?? '');
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

  router.start();

  // The reader must be ready before background PWA setup begins. Registration
  // is intentionally production-only and never participates in app startup.
  if (import.meta.env.PROD && (location.protocol === 'http:' || location.protocol === 'https:') && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.warn('Yomi offline support could not be enabled.', error));
  }
}

boot().catch(console.error);
