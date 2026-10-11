/* ─── Library Page ─── */

import { el, empty } from '../utils/dom';
import type { Novel, ReadingProgress, ReadingShelf, ShelfId, LibraryFilters, SortOption, NovelStatus } from '../models';
import { fetchAllNovels, fetchLibraryOptions, getLibraryNovelAvailability, mergeProgressIntoNovels, refreshLibraryNovelAvailability, type LibraryNovelAvailability } from '../data';
import { getAllReadingProgress } from '../storage';
import { getActiveShelves } from '../storage/shelves';
import { renderNavbar, renderFooter, renderContinueReading, renderNovelGrid, renderFilters } from '../components';
import type { FilterCallbacks } from '../components';

export async function renderLibraryPage(container: HTMLElement, initialSearch = ''): Promise<void> {
  empty(container);

  const page = el('div', { className: 'page page-library' });
  const navbarContainer = el('div', { className: 'navbar-container' });
  const mainContainer = el('main', { className: 'main-content' });
  const footerContainer = el('div', { className: 'footer-container' });

  page.appendChild(navbarContainer);
  page.appendChild(mainContainer);
  page.appendChild(footerContainer);
  container.appendChild(page);

  let navbarSearch: ((query: string) => void) | null = null;
  renderNavbar(navbarContainer, 'library', query => navbarSearch?.(query), initialSearch);
  renderFooter(footerContainer);

  // State
  let allNovels: (Novel & { readingProgress?: ReadingProgress; libraryAvailability?: LibraryNovelAvailability; readingShelf?: ShelfId })[] = [];
  let progressList: ReadingProgress[] = [];
  let progressUnavailable = false;
  let shelfRows: ReadingShelf[] = [];
  let shelvesUnavailable = false;
  let options: Awaited<ReturnType<typeof fetchLibraryOptions>> = { genres: [], tags: [], sourceLanguages: [], translationLanguages: [] };
  let filters: LibraryFilters = {
    search: initialSearch,
    genres: [],
    tags: [],
    sourceLanguages: [],
    translationLanguages: [],
    status: [],
    shelves: [],
    sort: 'recently-added' as SortOption,
  };

  // Loading
  mainContainer.appendChild(el('div', { className: 'loading', text: 'Loading library…' }));

  // Load data
  try {
    const novels = await fetchAllNovels();
    try {
      progressList = await getAllReadingProgress();
    } catch {
      // Progress is an enhancement; a storage hiccup must not hide the library.
      progressList = [];
      progressUnavailable = true;
    }
    try {
      shelfRows = await getActiveShelves();
    } catch {
      // Shelves are an enhancement too; never block browsing over them.
      shelfRows = [];
      shelvesUnavailable = true;
    }
    const shelfByNovel = new Map(shelfRows.map(row => [row.novelId, row.shelf]));
    await refreshLibraryNovelAvailability();
    allNovels = mergeProgressIntoNovels(novels, progressList).map(novel => {
      const assignedShelf = shelfByNovel.get(novel.id);
      return {
        ...novel,
        libraryAvailability: getLibraryNovelAvailability(novel.id),
        ...(assignedShelf ? { readingShelf: assignedShelf } : {}),
      };
    });
    options = await fetchLibraryOptions();
    mainContainer.innerHTML = '';
  } catch (err) {
    mainContainer.innerHTML = '';
    mainContainer.appendChild(el('div', { className: 'error-message', text: 'Failed to load novels. Please try again.' }));
    return;
  }

  // Helpers
  const sortNovels = (list: typeof allNovels): typeof allNovels => {
    const sorted = [...list];
    switch (filters.sort) {
      case 'recently-added':
        return sorted.sort((a, b) => b.createdAt - a.createdAt);
      case 'recently-updated':
        return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      case 'alphabetical':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'chapter-count':
        return sorted.sort((a, b) => b.chapters.length - a.chapters.length);
      default:
        return sorted;
    }
  };

  const filterNovels = (): typeof allNovels => {
    let filtered = [...allNovels];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.originalTitle.toLowerCase().includes(q) ||
        n.alternativeTitles.some(t => t.toLowerCase().includes(q)) ||
        n.author.toLowerCase().includes(q) ||
        n.genres.some(g => g.toLowerCase().includes(q)) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters.genres.length > 0) {
      filtered = filtered.filter(n => filters.genres.some(g => n.genres.includes(g)));
    }
    if (filters.tags.length > 0) {
      filtered = filtered.filter(n => filters.tags.some(t => n.tags.includes(t)));
    }
    if (filters.sourceLanguages.length > 0) {
      filtered = filtered.filter(n => filters.sourceLanguages.includes(n.sourceLanguage));
    }
    if (filters.translationLanguages.length > 0) {
      filtered = filtered.filter(n => filters.translationLanguages.includes(n.translationLanguage));
    }
    if (filters.status.length > 0) {
      filtered = filtered.filter(n => filters.status.includes(n.status));
    }
    if (filters.shelves.length > 0) {
      filtered = filtered.filter(n => n.readingShelf !== undefined && filters.shelves.includes(n.readingShelf));
    }

    return sortNovels(filtered);
  };

  // Filter callbacks
  const toggleArray = (arr: string[], value: string): string[] => {
    return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
  };

  const callbacks: FilterCallbacks = {
    onToggleGenre: (g) => { filters.genres = toggleArray(filters.genres, g); rerender(); },
    onToggleTag: (t) => { filters.tags = toggleArray(filters.tags, t); rerender(); },
    onToggleSourceLang: (l) => { filters.sourceLanguages = toggleArray(filters.sourceLanguages, l); rerender(); },
    onToggleTransLang: (l) => { filters.translationLanguages = toggleArray(filters.translationLanguages, l); rerender(); },
    onToggleStatus: (s) => { filters.status = toggleArray(filters.status, s) as NovelStatus[]; rerender(); },
    onToggleShelf: (s) => { filters.shelves = toggleArray(filters.shelves, s) as ShelfId[]; rerender(); },
    onSortChange: (s) => { filters.sort = s; rerender(); },
    onClear: () => {
      filters = { search: '', genres: [], tags: [], sourceLanguages: [], translationLanguages: [], status: [], shelves: [], sort: 'recently-added' };
      const navbarSearch = navbarContainer.querySelector<HTMLInputElement>('.navbar-search');
      if (navbarSearch) navbarSearch.value = '';
      if (window.location.hash.startsWith('#library?')) history.replaceState(null, '', '#library');
      rerender();
    },
  };

  // Build layout
  const sidebarEl = el('aside', { className: 'library-sidebar' });
  const contentEl = el('div', { className: 'library-content' });

  mainContainer.appendChild(el('div', { className: 'library-layout' },
    sidebarEl,
    contentEl,
  ));

  const rerender = () => {
    renderFilters(sidebarEl, filters, options, callbacks);

    empty(contentEl);
    if (progressUnavailable) {
      contentEl.appendChild(el('p', {
        className: 'library-progress-notice',
        text: 'Reading progress is temporarily unavailable. Your library is still ready to browse.',
        role: 'status',
      }));
    }
    if (shelvesUnavailable) {
      contentEl.appendChild(el('p', {
        className: 'library-progress-notice',
        text: 'Shelves are temporarily unavailable. Your library is still ready to browse.',
        role: 'status',
      }));
    }
    const filtered = filterNovels();

    const noFilters = !filters.search && filters.genres.length === 0 && filters.tags.length === 0 &&
      filters.sourceLanguages.length === 0 && filters.translationLanguages.length === 0 &&
      filters.status.length === 0 && filters.shelves.length === 0;

    if (noFilters && progressList.length > 0) {
      const continueSection = el('div', { className: 'continue-section' });
      contentEl.appendChild(continueSection);
      renderContinueReading(continueSection, allNovels);
    }

    const gridSection = el('div', { className: 'library-grid-section' });
    contentEl.appendChild(gridSection);
    renderNovelGrid(gridSection, filtered, noFilters ? 'No novels found.' : 'No novels match your filters.');

    if (filtered.length > 0) {
      const sortLabel = el('p', { className: 'library-count', text: `${filtered.length} novel${filtered.length !== 1 ? 's' : ''}` });
      contentEl.insertBefore(sortLabel, gridSection);
    }
  };

  navbarSearch = (query) => { filters.search = query; rerender(); };

  // Initial render
  rerender();
}
