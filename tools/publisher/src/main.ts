import { parseEpub, type ParsedEpub } from '../../../src/epub-import/index';
import './style.css';

type CatalogNovel = {
  id: string;
  title: string;
  author: string;
  cover: string;
  status: string;
  volumes?: Array<{ chapterCount?: number }>;
  chapters?: unknown[];
};

type StageResult = { token: string; size: number };
type VolumeDraft = { title: string; chapterIndexes: number[] };

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const root = document.querySelector<HTMLDivElement>('#app')!;
const state = {
  epubFile: null as File | null,
  coverFile: null as File | null,
  parsed: null as ParsedEpub | null,
  id: '',
  volumes: [] as VolumeDraft[],
  stagedEpub: null as StageResult | null,
  stagedCover: null as StageResult | null,
  busy: false,
  buildSucceeded: false,
  configReady: false,
  catalogIds: new Set<string>(),
};
let previewFile: File | null = null;
let previewObjectUrl = '';

root.innerHTML = `
  <header class="topbar"><a class="wordmark" href="/" aria-label="Yomi Publisher home"><span class="mark">Y</span> Yomi <span class="wordmark-sub">PUBLISHER</span></a><span class="local-pill"><span></span> Runs on this device</span></header>
  <main class="layout">
    <section class="intro">
      <p class="eyebrow">OWNER WORKSPACE · STATIC CATALOG</p>
      <h1>Publish a book to Yomi</h1>
      <p class="lede">Add a title to the shared library. Your readers’ personal EPUBs stay on their own devices.</p>
    </section>
    <section class="notice" aria-label="Security and privacy"><span class="notice-icon" aria-hidden="true">⌂</span><div><strong>Local publishing only</strong><p>This tool is only available on your computer. It writes shared book files into this project; no personal reader library is uploaded.</p></div></section>
    <div class="columns">
      <div class="flow">
        <section class="panel step-panel" aria-labelledby="book-heading">
          <div class="step-heading"><span class="step-number">01</span><div><h2 id="book-heading">Choose your files</h2><p>We’ll read the chapter order and suggest book details from the EPUB.</p></div></div>
          <div class="file-grid">
            <label class="file-card" for="epub-file"><span class="file-icon" aria-hidden="true">EPUB</span><span class="file-label">Book file</span><span class="file-hint" id="epub-file-label">Choose an EPUB, up to 25 MiB</span><input id="epub-file" type="file" accept=".epub,application/epub+zip" /></label>
            <label class="file-card" for="cover-file"><span class="file-icon image-icon" aria-hidden="true">▧</span><span class="file-label">Cover image</span><span class="file-hint" id="cover-file-label">PNG, JPEG, or WebP, up to 25 MiB</span><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          </div>
          <p class="embedded-line" id="embedded-line" hidden></p>
          <div id="parse-status" class="inline-status" role="status" aria-live="polite"></div>
        </section>

        <section class="panel" aria-labelledby="details-heading">
          <div class="step-heading"><span class="step-number">02</span><div><h2 id="details-heading">Review book details</h2><p>Make sure the title, languages, and book identity are right.</p></div></div>
          <div class="form-grid">
            <label class="field span-2"><span>Book title</span><input id="title" autocomplete="off" placeholder="The title readers will see" /></label>
            <label class="field"><span>Original title</span><input id="original-title" autocomplete="off" placeholder="Title in the source language" /></label>
            <label class="field"><span>Author</span><input id="author" autocomplete="off" placeholder="Author name" /></label>
            <label class="field span-2"><span>Stable book ID</span><div class="slug-input"><span>yomi /</span><input id="book-id" autocomplete="off" spellcheck="false" placeholder="a-stable-book-id" /></div><small id="id-feedback">Used in published file names. IDs cannot replace an existing book.</small></label>
            <label class="field"><span>Source language</span><input id="source-language" autocomplete="off" placeholder="Japanese" /></label>
            <label class="field"><span>Translation language</span><input id="translation-language" autocomplete="off" placeholder="English" /></label>
            <label class="field span-2"><span>Description</span><textarea id="description" rows="4" placeholder="A short description for the library"></textarea></label>
            <label class="field"><span>Genres</span><input id="genres" autocomplete="off" placeholder="Fantasy, Romance" /><small>Separate entries with commas.</small></label>
            <label class="field"><span>Tags</span><input id="tags" autocomplete="off" placeholder="Found family, Magic" /><small>Separate entries with commas.</small></label>
            <label class="field"><span>Publication status</span><select id="status"><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="hiatus">On hiatus</option><option value="dropped">Dropped</option></select></label>
            <label class="field"><span>Chapters per volume</span><div class="volume-control"><input id="chapters-per-volume" type="number" min="1" max="250" value="10" /><span>chapters, then start a new volume</span></div><small>You can move individual chapters below.</small></label>
          </div>
          <div class="chapter-section"><div class="section-title-row"><div><h3>Chapter order</h3><p id="chapter-count">Choose an EPUB to see chapters.</p></div><button class="button quiet" id="add-volume" type="button" disabled>Add volume</button></div><div id="chapter-list" class="chapter-list"></div></div>
        </section>

        <section class="panel preview-panel" aria-labelledby="preview-heading">
          <div class="step-heading"><span class="step-number">03</span><div><h2 id="preview-heading">Preview the library card</h2><p>Check what readers will see in the shared catalog.</p></div></div>
          <div class="catalog-preview" id="catalog-preview"><div class="preview-cover empty-cover" id="preview-cover">Cover preview</div><div class="preview-copy"><span class="status-badge" id="preview-status">ONGOING</span><h3 id="preview-title">Your book title</h3><p id="preview-author">Author name</p><div class="preview-meta" id="preview-meta">Chapters and languages will appear here</div><p class="preview-description" id="preview-description">Your description will appear here.</p><div class="chips" id="preview-genres"></div></div></div>
          <button class="button primary full-button" id="review-button" type="button" disabled>Review publication</button>
          <div id="publish-status" class="result-status" role="status" aria-live="polite"></div>
        </section>
      </div>
      <aside class="side-rail">
        <section class="panel collection-panel"><div class="section-title-row"><div><p class="eyebrow">CURRENT COLLECTION</p><h2>Shared books</h2></div><span class="count-badge" id="catalog-count">…</span></div><p class="side-intro">These books are published for everyone who uses Yomi.</p><div id="catalog-list" class="catalog-list" aria-live="polite"></div></section>
        <section class="panel release-panel"><p class="eyebrow">SITE RELEASE</p><h2>Build and deploy</h2><p>Publishing files and releasing the site are separate actions.</p><div class="config-state" id="config-state" role="status">Checking local Pages project setup…</div><button class="button secondary full-button" id="build-button" type="button">Build Yomi site</button><button class="button release-button full-button" id="preview-deploy-button" type="button" disabled>Deploy a preview</button><button class="button danger-button full-button" id="production-deploy-button" type="button" disabled>Deploy to production…</button><pre class="command-output" id="command-output" aria-live="polite" hidden></pre></section>
      </aside>
    </div>
  </main>
  <dialog class="review-dialog" id="review-dialog" aria-labelledby="review-dialog-title"><div class="dialog-head"><div><p class="eyebrow">FINAL CHECK</p><h2 id="review-dialog-title">Review this publication</h2></div><button class="icon-button" id="close-review" type="button" aria-label="Close review">×</button></div><div id="review-summary" class="review-summary"></div><p class="dialog-warning">Continuing writes the EPUB, cover, chapter data, and a new entry to this project. It will not replace an existing catalog book.</p><div class="dialog-actions"><button class="button quiet" id="cancel-review" type="button">Go back</button><button class="button primary" id="confirm-publish" type="button">Publish to shared catalog</button></div></dialog>
  <div class="toast-region" id="toast" role="status" aria-live="polite"></div>
`;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const epubInput = byId<HTMLInputElement>('epub-file');
const coverInput = byId<HTMLInputElement>('cover-file');

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function commaList(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function previewCoverUrl(): string {
  if (previewFile !== state.coverFile) {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewFile = state.coverFile;
    previewObjectUrl = state.coverFile ? URL.createObjectURL(state.coverFile) : '';
  }
  return previewObjectUrl || state.parsed?.coverDataUrl || '';
}

function updatePreview(): void {
  byId('preview-title').textContent = byId<HTMLInputElement>('title').value.trim() || 'Your book title';
  byId('preview-author').textContent = byId<HTMLInputElement>('author').value.trim() || 'Author name';
  byId('preview-description').textContent = byId<HTMLTextAreaElement>('description').value.trim() || 'Your description will appear here.';
  const status = byId<HTMLSelectElement>('status');
  byId('preview-status').textContent = status.options[status.selectedIndex].text.toUpperCase();
  const count = state.parsed?.chapters.length ?? 0;
  const languages = [byId<HTMLInputElement>('source-language').value.trim(), byId<HTMLInputElement>('translation-language').value.trim()].filter(Boolean).join(' → ');
  byId('preview-meta').textContent = count ? `${count} chapters · ${Math.ceil(count / Math.max(1, Number(byId<HTMLInputElement>('chapters-per-volume').value) || 1))} volumes${languages ? ` · ${languages}` : ''}` : 'Chapters and languages will appear here';
  const chips = byId('preview-genres');
  chips.replaceChildren(...commaList(byId<HTMLInputElement>('genres').value).slice(0, 5).map(value => {
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = value; return chip;
  }));
  const cover = byId('preview-cover');
  const source = previewCoverUrl();
  cover.replaceChildren();
  if (source) {
    cover.classList.remove('empty-cover');
    const image = document.createElement('img'); image.src = source; image.alt = 'Selected book cover preview'; cover.append(image);
  } else { cover.classList.add('empty-cover'); cover.textContent = 'Cover preview'; }
  validateForm();
}

function setupVolumes(): void {
  if (!state.parsed) { state.volumes = []; renderChapters(); return; }
  const perVolume = Math.max(1, Number(byId<HTMLInputElement>('chapters-per-volume').value) || 10);
  const volumeCount = Math.ceil(state.parsed.chapters.length / perVolume);
  state.volumes = Array.from({ length: volumeCount }, (_, index) => ({ title: `Volume ${index + 1}`, chapterIndexes: [] }));
  state.parsed.chapters.forEach((_, index) => state.volumes[Math.floor(index / perVolume)].chapterIndexes.push(index));
  renderChapters();
}

function renderChapters(): void {
  const list = byId('chapter-list'); list.replaceChildren();
  const parsed = state.parsed;
  byId('chapter-count').textContent = parsed ? `${parsed.chapters.length} chapters · drag-free volume assignment` : 'Choose an EPUB to see chapters.';
  byId<HTMLButtonElement>('add-volume').disabled = !parsed;
  if (!parsed) return;
  parsed.chapters.forEach((chapter, index) => {
    const row = document.createElement('div'); row.className = 'chapter-row';
    const number = document.createElement('span'); number.className = 'chapter-index'; number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('input'); title.className = 'chapter-title-input'; title.setAttribute('aria-label', `Chapter ${index + 1} title`); title.value = chapter.title || `Chapter ${index + 1}`;
    const volume = document.createElement('select'); volume.className = 'chapter-volume-select'; volume.setAttribute('aria-label', `Volume for chapter ${index + 1}`);
    state.volumes.forEach((draft, volumeIndex) => { const option = document.createElement('option'); option.value = String(volumeIndex); option.textContent = draft.title; volume.add(option); });
    const current = state.volumes.findIndex(draft => draft.chapterIndexes.includes(index)); volume.value = String(Math.max(0, current));
    volume.addEventListener('change', () => assignChapter(index, Number(volume.value)));
    title.addEventListener('input', () => { chapter.title = title.value; });
    row.append(number, title, volume); list.append(row);
  });
}

function assignChapter(chapterIndex: number, volumeIndex: number): void {
  state.volumes.forEach(volume => volume.chapterIndexes = volume.chapterIndexes.filter(index => index !== chapterIndex));
  state.volumes[volumeIndex]?.chapterIndexes.push(chapterIndex);
  state.volumes = state.volumes.filter((volume, index) => volume.chapterIndexes.length || index === volumeIndex);
  state.volumes.forEach((volume, index) => { volume.title = `Volume ${index + 1}`; });
  renderChapters(); updatePreview();
}

function validateForm(): boolean {
  const id = byId<HTMLInputElement>('book-id').value.trim();
  const ready = !!state.parsed && !!(state.coverFile || state.parsed.coverDataUrl) &&
    !!byId<HTMLInputElement>('title').value.trim() && !!byId<HTMLInputElement>('original-title').value.trim() &&
    !!byId<HTMLInputElement>('author').value.trim() && !!byId<HTMLInputElement>('description').value.trim() &&
    !!byId<HTMLInputElement>('source-language').value.trim() && !!byId<HTMLInputElement>('translation-language').value.trim() &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && !state.catalogIds.has(id) && state.volumes.length > 0 && state.volumes.every(volume => volume.chapterIndexes.length > 0);
  byId<HTMLButtonElement>('review-button').disabled = !ready || state.busy;
  const idInput = byId<HTMLInputElement>('book-id');
  idInput.setAttribute('aria-invalid', String(!!id && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || state.catalogIds.has(id))));
  idInput.title = state.catalogIds.has(id) ? 'This ID is already used by a shared book. Choose a new stable ID.' : 'Use lowercase letters, numbers, and single hyphens.';
  byId('id-feedback').textContent = state.catalogIds.has(id) ? 'This ID already belongs to a shared book. Choose a different ID.' : 'Used in published file names. IDs cannot replace an existing book.';
  return ready;
}

async function parseSelectedEpub(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This EPUB is over the 25 MiB per-file publishing limit. Choose a smaller file.');
  byId('parse-status').textContent = 'Reading chapters and book details…';
  const parsed = await parseEpub(await file.arrayBuffer());
  const replacingBook = !!state.epubFile;
  state.epubFile = file; state.parsed = parsed; state.stagedEpub = null;
  if (replacingBook) {
    byId<HTMLInputElement>('title').value = parsed.title;
    byId<HTMLInputElement>('original-title').value = parsed.title;
    byId<HTMLInputElement>('author').value = parsed.author;
    byId<HTMLInputElement>('source-language').value = parsed.language;
    byId<HTMLInputElement>('translation-language').value = 'English';
    byId<HTMLTextAreaElement>('description').value = parsed.description;
    byId<HTMLInputElement>('genres').value = '';
    byId<HTMLInputElement>('tags').value = '';
    byId<HTMLSelectElement>('status').value = 'ongoing';
    byId<HTMLInputElement>('book-id').dataset.userEdited = 'false';
    state.coverFile = null; state.stagedCover = null; coverInput.value = '';
    byId('cover-file-label').textContent = parsed.coverDataUrl ? 'Using the image embedded in the EPUB' : 'PNG, JPEG, or WebP, up to 25 MiB';
  }
  byId('epub-file-label').textContent = `${file.name} · ${formatBytes(file.size)}`;
  if (!byId<HTMLInputElement>('title').value || byId<HTMLInputElement>('title').value === 'Untitled') byId<HTMLInputElement>('title').value = parsed.title;
  if (!byId<HTMLInputElement>('original-title').value) byId<HTMLInputElement>('original-title').value = parsed.title;
  if (!byId<HTMLInputElement>('author').value || byId<HTMLInputElement>('author').value === 'Unknown') byId<HTMLInputElement>('author').value = parsed.author;
  if (!byId<HTMLInputElement>('source-language').value) byId<HTMLInputElement>('source-language').value = parsed.language;
  if (!byId<HTMLInputElement>('translation-language').value) byId<HTMLInputElement>('translation-language').value = 'English';
  if (!byId<HTMLTextAreaElement>('description').value) byId<HTMLTextAreaElement>('description').value = parsed.description;
  if (!byId<HTMLInputElement>('book-id').value) byId<HTMLInputElement>('book-id').value = parsed.suggestedId;
  byId<HTMLInputElement>('book-id').dataset.userEdited = 'false';
  byId('embedded-line').toggleAttribute('hidden', !parsed.coverDataUrl);
  byId('embedded-line').innerHTML = parsed.coverDataUrl ? `The EPUB includes a cover. <button type="button" class="inline-button" id="use-embedded-cover">Use EPUB cover</button>` : '';
  document.getElementById('use-embedded-cover')?.addEventListener('click', () => { state.coverFile = null; state.stagedCover = null; byId('cover-file-label').textContent = 'Using the image embedded in the EPUB'; updatePreview(); });
  setupVolumes(); updatePreview();
  byId('parse-status').textContent = `Ready to review ${parsed.chapters.length} chapters from ${file.name}.`;
}

function formatBytes(bytes: number): string { return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`; }

function dataUrlBytes(value: string): { bytes: Uint8Array; type: string } {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i);
  if (!match) throw new Error('The EPUB cover format is unsupported. Choose a PNG, JPEG, or WebP cover image.');
  const raw = atob(match[2]); const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return { bytes, type: match[1] };
}

function buildPublication(): { novel: Record<string, unknown>; chapters: Array<Record<string, unknown>> } {
  const parsed = state.parsed!; const id = byId<HTMLInputElement>('book-id').value.trim();
  const chapters: Array<Record<string, unknown>> = [];
  const volumes = state.volumes.map((draft, volumeIndex) => ({
    id: `${id}-vol-${volumeIndex + 1}`, novelId: id, volumeNumber: volumeIndex + 1,
    title: draft.title, chapterCount: draft.chapterIndexes.length,
  }));
  state.volumes.forEach((draft, volumeIndex) => [...draft.chapterIndexes].sort((a, b) => a - b).forEach((chapterIndex, withinIndex) => {
    const source = parsed.chapters[chapterIndex];
    chapters.push({ id: `${id}-ch-${chapterIndex + 1}`, novelId: id, volumeId: volumes[volumeIndex].id,
      globalChapterNumber: chapterIndex + 1, volumeChapterNumber: withinIndex + 1,
      title: source.title.trim() || `Chapter ${chapterIndex + 1}`, content: source.content,
      wordCount: source.wordCount, metadata: {} });
  }));
  chapters.sort((a, b) => Number(a.globalChapterNumber) - Number(b.globalChapterNumber));
  const novel = {
    id, title: byId<HTMLInputElement>('title').value.trim(), originalTitle: byId<HTMLInputElement>('original-title').value.trim(),
    alternativeTitles: [], author: byId<HTMLInputElement>('author').value.trim(), description: byId<HTMLTextAreaElement>('description').value.trim(),
    cover: '', sourceLanguage: byId<HTMLInputElement>('source-language').value.trim(), translationLanguage: byId<HTMLInputElement>('translation-language').value.trim(),
    status: byId<HTMLSelectElement>('status').value, genres: commaList(byId<HTMLInputElement>('genres').value), tags: commaList(byId<HTMLInputElement>('tags').value),
    volumes, chapters: chapters.map(({ content: _content, ...chapter }) => chapter), downloads: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
  return { novel, chapters };
}

async function stageFile(url: string, file: Blob, contentType: string): Promise<StageResult> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: file });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The file could not be staged locally.'); return data;
}

async function publish(): Promise<void> {
  if (!validateForm() || !state.epubFile || !state.parsed) return;
  state.busy = true; validateForm(); byId('confirm-publish').textContent = 'Publishing…';
  setStatus('publish-status', 'Preparing the selected files…', 'working');
  try {
    if (!state.stagedEpub) state.stagedEpub = await stageFile('/api/stage/epub', state.epubFile, 'application/epub+zip');
    if (!state.stagedCover) {
      const embedded = !state.coverFile && state.parsed.coverDataUrl ? dataUrlBytes(state.parsed.coverDataUrl) : null;
      if (embedded) {
        const embeddedCopy = new Uint8Array(embedded.bytes);
        state.stagedCover = await stageFile('/api/stage/cover', new Blob([embeddedCopy.buffer as ArrayBuffer], { type: embedded.type }), embedded.type);
      }
      else if (state.coverFile) state.stagedCover = await stageFile('/api/stage/cover', state.coverFile, state.coverFile.type);
      else throw new Error('Choose a cover image or use the image embedded in the EPUB.');
    }
    const { novel, chapters } = buildPublication();
    const response = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novel, chapters, epubToken: state.stagedEpub.token, coverToken: state.stagedCover.token }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The book was not published.');
    setStatus('publish-status', `Published “${novel.title}” to the shared catalog. Files: ${result.paths.join(', ')}`, 'success');
    state.stagedEpub = null; state.stagedCover = null; await loadCatalog(); closeReview();
  } catch (error) { setStatus('publish-status', error instanceof Error ? error.message : String(error), 'error'); }
  finally { state.busy = false; byId('confirm-publish').textContent = 'Publish to shared catalog'; validateForm(); }
}

function setStatus(id: string, message: string, type: string): void { const node = byId(id); node.className = `result-status ${type}`; node.textContent = message; }

async function apiJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`); return data;
}

async function loadCatalog(): Promise<void> {
  const list = byId('catalog-list'); list.innerHTML = '<p class="muted">Loading the shared catalog…</p>';
  try {
    const { novels } = await apiJson('/api/catalog');
    state.catalogIds = new Set<string>(novels.map((novel: CatalogNovel) => novel.id));
    byId('catalog-count').textContent = String(novels.length);
    list.replaceChildren();
    novels.forEach((novel: CatalogNovel) => {
      const row = document.createElement('article'); row.className = 'catalog-row';
      const image = document.createElement('div'); image.className = 'catalog-thumb catalog-monogram'; image.setAttribute('aria-hidden', 'true'); image.textContent = novel.title.slice(0, 1).toUpperCase();
      const copy = document.createElement('div'); copy.className = 'catalog-row-copy';
      const title = document.createElement('strong'); title.textContent = novel.title;
      const meta = document.createElement('span'); meta.textContent = `${novel.author} · ${(novel.chapters?.length ?? 0).toLocaleString()} chapters`;
      const id = document.createElement('code'); id.textContent = novel.id;
      copy.append(title, meta, id); row.append(image, copy);
      if (novel.id === 'the-unemployed-demon-lord') { const preserved = document.createElement('span'); preserved.className = 'preserved-badge'; preserved.textContent = 'KEPT'; row.append(preserved); }
      list.append(row);
    });
    if (!novels.length) list.innerHTML = '<p class="muted">No books are published yet.</p>';
    validateForm();
  } catch (error) { list.innerHTML = `<p class="error-text">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`; }
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }

async function loadConfig(): Promise<void> {
  try {
    const { configured, projectName, previewBranch, message } = await apiJson('/api/config');
    state.configReady = configured;
    byId('config-state').textContent = configured ? `Connected to local Pages project “${projectName}”. Preview branch: ${previewBranch}.` : message;
    byId('config-state').classList.toggle('config-warning', !configured);
  } catch (error) { byId('config-state').textContent = error instanceof Error ? error.message : String(error); }
  updateReleaseButtons();
}

function updateReleaseButtons(): void {
  byId<HTMLButtonElement>('preview-deploy-button').disabled = !state.buildSucceeded || !state.configReady || state.busy;
  byId<HTMLButtonElement>('production-deploy-button').disabled = !state.buildSucceeded || !state.configReady || state.busy;
}

function outputCommand(message: string): void { const output = byId('command-output'); output.hidden = false; output.textContent = message; }

async function runBuild(): Promise<void> {
  state.busy = true; state.buildSucceeded = false; updateReleaseButtons();
  byId<HTMLButtonElement>('build-button').disabled = true; byId('build-button').textContent = 'Building…'; outputCommand('Building the public Yomi site…');
  try {
    const result = await apiJson('/api/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    state.buildSucceeded = true; outputCommand(`Build completed successfully.\n\n${result.output || 'No additional output.'}`); toast('The public site build is ready.');
  } catch (error) { outputCommand(`Build failed. The current deployed site is unchanged.\n\n${error instanceof Error ? error.message : String(error)}`); }
  finally { state.busy = false; byId<HTMLButtonElement>('build-button').disabled = false; byId('build-button').textContent = 'Build Yomi site'; updateReleaseButtons(); }
}

async function runDeploy(environment: 'preview' | 'production'): Promise<void> {
  if (!state.buildSucceeded) return;
  if (environment === 'production') {
    if (!window.confirm('Deploy the current build to the production Yomi site? This changes what every visitor sees.')) return;
    const confirmation = window.prompt('Type DEPLOY to confirm production publishing.');
    if (confirmation !== 'DEPLOY') { toast('Production deployment cancelled.'); return; }
  }
  state.busy = true; updateReleaseButtons(); outputCommand(`Deploying ${environment}…`);
  try {
    const result = await apiJson('/api/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment, confirmation: environment === 'production' ? 'DEPLOY' : '' }) });
    outputCommand(`${environment === 'production' ? 'Production' : 'Preview'} deployment completed.\n\n${result.output || ''}`);
  } catch (error) { outputCommand(`Deployment failed. Cloudflare keeps the last successful release available. Check the output and retry after fixing the issue.\n\n${error instanceof Error ? error.message : String(error)}`); }
  finally { state.busy = false; updateReleaseButtons(); }
}

function toast(message: string): void { const node = byId('toast'); node.textContent = message; node.classList.add('visible'); window.setTimeout(() => node.classList.remove('visible'), 3500); }

function openReview(): void {
  if (!validateForm()) return;
  const { novel, chapters } = buildPublication();
  const summary = byId('review-summary'); summary.replaceChildren();
  const cover = document.createElement('div'); cover.className = 'review-cover';
  const source = previewCoverUrl();
  if (source) { const img = document.createElement('img'); img.src = source; img.alt = ''; cover.append(img); }
  const details = document.createElement('div'); details.className = 'review-details';
  const values = [
    ['Title', String(novel.title)], ['Author', String(novel.author)], ['Stable ID', String(novel.id)],
    ['Languages', `${novel.sourceLanguage} → ${novel.translationLanguage}`], ['Chapters', String(chapters.length)],
    ['Volumes', state.volumes.map(volume => `${volume.title} (${volume.chapterIndexes.length})`).join(' · ')],
    ['EPUB', `${state.epubFile?.name ?? 'EPUB'} · ${formatBytes(state.epubFile?.size ?? 0)}`],
    ['Cover', state.coverFile?.name ?? 'Embedded EPUB cover'],
  ];
  values.forEach(([label, value]) => { const row = document.createElement('div'); row.className = 'review-detail'; const key = document.createElement('span'); key.textContent = label; const val = document.createElement('strong'); val.textContent = value; row.append(key, val); details.append(row); });
  summary.append(cover, details); byId<HTMLDialogElement>('review-dialog').showModal();
}

function closeReview(): void { byId<HTMLDialogElement>('review-dialog').close(); }

epubInput.addEventListener('change', async () => {
  const file = epubInput.files?.[0]; if (!file) return;
  try { await parseSelectedEpub(file); } catch (error) { state.parsed = null; state.epubFile = null; state.volumes = []; renderChapters(); setStatus('parse-status', error instanceof Error ? error.message : String(error), 'error'); }
  updatePreview();
});
coverInput.addEventListener('change', () => {
  const file = coverInput.files?.[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_FILE_BYTES) { setStatus('parse-status', 'Choose a PNG, JPEG, or WebP cover image smaller than 25 MiB.', 'error'); coverInput.value = ''; return; }
  state.coverFile = file; state.stagedCover = null; byId('cover-file-label').textContent = `${file.name} · ${formatBytes(file.size)}`; updatePreview();
});
byId<HTMLInputElement>('book-id').addEventListener('input', () => { byId<HTMLInputElement>('book-id').dataset.userEdited = 'true'; validateForm(); });
byId<HTMLInputElement>('title').addEventListener('input', () => { const id = byId<HTMLInputElement>('book-id'); if (id.dataset.userEdited !== 'true') id.value = slugify(byId<HTMLInputElement>('title').value); updatePreview(); });
for (const id of ['original-title', 'author', 'description', 'source-language', 'translation-language', 'genres', 'tags', 'status']) byId(id).addEventListener('input', updatePreview);
byId<HTMLInputElement>('chapters-per-volume').addEventListener('change', () => { setupVolumes(); updatePreview(); });
byId<HTMLButtonElement>('add-volume').addEventListener('click', () => { if (!state.parsed) return; state.volumes.push({ title: `Volume ${state.volumes.length + 1}`, chapterIndexes: [] }); const last = state.parsed.chapters.length - 1; const existing = state.volumes.findIndex(volume => volume.chapterIndexes.includes(last)); if (existing >= 0) { state.volumes[existing].chapterIndexes.pop(); state.volumes[state.volumes.length - 1].chapterIndexes.push(last); } renderChapters(); updatePreview(); });
byId('review-button').addEventListener('click', openReview);
byId('confirm-publish').addEventListener('click', publish);
byId('close-review').addEventListener('click', closeReview); byId('cancel-review').addEventListener('click', closeReview);
byId('build-button').addEventListener('click', runBuild);
byId('preview-deploy-button').addEventListener('click', () => runDeploy('preview'));
byId('production-deploy-button').addEventListener('click', () => runDeploy('production'));
loadCatalog(); loadConfig(); updatePreview();
