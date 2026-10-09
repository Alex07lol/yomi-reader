import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { sanitizeChapterHtml } from '../../src/utils/sanitize-chapter-html.mjs';

// Cloudflare Pages currently permits a maximum of 25 MiB for each site asset.
export const MAX_PAGES_ASSET_BYTES = 25 * 1024 * 1024;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_STATUSES = new Set(['ongoing', 'completed', 'hiatus', 'dropped']);

/** Read and parse the public shared catalog. */
export async function readCatalog(root) {
  const projectRoot = await canonicalRoot(root);
  const catalogPath = insideRoot(projectRoot, 'public', 'data', 'novels.json');
  await assertSafeDestination(projectRoot, catalogPath);
  const parsed = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('The shared catalog must be a JSON array in public/data/novels.json.');
  }
  return parsed;
}

/** Validate a shared publication without changing project files. */
export async function validatePublication({ id, novel, chapters, epubBytes, coverBytes, root }) {
  const projectRoot = await canonicalRoot(root);
  const catalog = await readCatalog(projectRoot);
  validateId(id);

  if (!novel || typeof novel !== 'object' || Array.isArray(novel)) {
    throw new Error('Book metadata must be an object.');
  }
  if (novel.id !== id) throw new Error('The book ID must match the stable publication ID.');
  if (catalog.some(entry => entry?.id === id)) {
    throw new Error(`The ID “${id}” is already in the shared catalog. Choose a new stable ID; existing files will not be overwritten.`);
  }

  requireText(novel.title, 'Book title');
  requireText(novel.originalTitle, 'Original title');
  requireText(novel.author, 'Author');
  requireText(novel.description, 'Book description');
  requireText(novel.sourceLanguage, 'Source language');
  requireText(novel.translationLanguage, 'Translation language');
  if (!VALID_STATUSES.has(novel.status)) throw new Error('Choose a valid book status.');
  if (!Array.isArray(novel.alternativeTitles) || !Array.isArray(novel.genres) || !Array.isArray(novel.tags)) {
    throw new Error('Alternative titles, genres, and tags must be arrays.');
  }
  for (const [label, values] of [['Alternative titles', novel.alternativeTitles], ['Genres', novel.genres], ['Tags', novel.tags]]) {
    if (!values.every(value => typeof value === 'string')) throw new Error(`${label} must contain only text values.`);
  }
  if (!Array.isArray(novel.volumes) || novel.volumes.length === 0) {
    throw new Error('Add at least one volume before publishing.');
  }
  const volumeIds = new Set();
  for (const volume of novel.volumes) {
    if (!volume || volume.novelId !== id || !isNonEmptyString(volume.id) ||
        !Number.isInteger(volume.volumeNumber) || volume.volumeNumber < 1 ||
        !Number.isInteger(volume.chapterCount) || volume.chapterCount < 0 || !isNonEmptyString(volume.title)) {
      throw new Error('Volume metadata is incomplete or does not belong to this book.');
    }
    if (volumeIds.has(volume.id)) throw new Error('Volume IDs must be unique within the book.');
    volumeIds.add(volume.id);
  }

  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('The EPUB must contain at least one readable chapter.');
  }
  const chapterIds = new Set();
  const globalNumbers = new Set();
  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== 'object' || chapter.novelId !== id ||
        !isNonEmptyString(chapter.id) || !isNonEmptyString(chapter.volumeId) ||
        !volumeIds.has(chapter.volumeId) || !isNonEmptyString(chapter.title) ||
        typeof chapter.content !== 'string' || chapter.content.trim() === '' ||
        !Number.isInteger(chapter.globalChapterNumber) || chapter.globalChapterNumber < 1 ||
        !Number.isInteger(chapter.volumeChapterNumber) || chapter.volumeChapterNumber < 1 ||
        !Number.isInteger(chapter.wordCount) || chapter.wordCount < 0 ||
        !chapter.metadata || typeof chapter.metadata !== 'object' || Array.isArray(chapter.metadata)) {
      throw new Error('Chapter data is incomplete or does not match the Novel/Chapter format.');
    }
    if (!Object.values(chapter.metadata).every(value => typeof value === 'string')) {
      throw new Error('Chapter metadata values must be text.');
    }
    if (sanitizeChapterHtml(chapter.content) !== chapter.content) {
      throw new Error(`Chapter “${chapter.title}” contains unsafe HTML. Re-import it through Yomi so unsupported markup is removed before publishing.`);
    }
    if (chapterIds.has(chapter.id) || globalNumbers.has(chapter.globalChapterNumber)) {
      throw new Error('Chapter IDs and global chapter numbers must be unique within the book.');
    }
    chapterIds.add(chapter.id);
    globalNumbers.add(chapter.globalChapterNumber);
  }
  for (const volume of novel.volumes) {
    const count = chapters.filter(chapter => chapter.volumeId === volume.id).length;
    if (volume.chapterCount !== count) {
      throw new Error(`Volume “${volume.title}” says it has ${volume.chapterCount} chapters, but ${count} were supplied.`);
    }
  }

  const epub = asBytes(epubBytes, 'EPUB');
  const cover = asBytes(coverBytes, 'Cover image');
  checkAssetSize(epub.byteLength, 'EPUB');
  checkAssetSize(cover.byteLength, 'Cover image');
  if (epub.byteLength < 4 || epub[0] !== 0x50 || epub[1] !== 0x4b) {
    throw new Error('The selected EPUB does not look like a ZIP-based EPUB file.');
  }
  const coverExtension = detectCoverExtension(cover);
  const chaptersJson = Buffer.from(JSON.stringify(chapters, null, 2));
  checkAssetSize(chaptersJson.byteLength, 'Chapter data');

  // Verify lexical containment for every generated destination before any writes.
  insideRoot(projectRoot, 'public', 'covers', `${id}.${coverExtension}`);
  insideRoot(projectRoot, 'public', 'epubs', `${id}.epub`);
  insideRoot(projectRoot, 'public', 'data', 'chapters', `${id}.json`);
  insideRoot(projectRoot, 'public', 'data', 'novels.json');
}

/**
 * Add one shared book. Assets are staged outside public/, installed without
 * replacing any existing path, and the catalog is atomically swapped last.
 */
export async function publishCatalogEntry({ root, novel, chapters, epubBytes, coverBytes }) {
  const projectRoot = await canonicalRoot(root);
  const id = novel?.id;
  const epub = asBytes(epubBytes, 'EPUB');
  const cover = asBytes(coverBytes, 'Cover image');
  const coverExtension = detectCoverExtension(cover);
  const catalogPath = insideRoot(projectRoot, 'public', 'data', 'novels.json');
  const dataDirectory = insideRoot(projectRoot, 'public', 'data');
  const epubDirectory = insideRoot(projectRoot, 'public', 'epubs');
  const stagingParent = insideRoot(projectRoot, 'tools', 'publisher', '.staging');
  const lockPath = insideRoot(projectRoot, 'tools', 'publisher', '.publish.lock');
  const token = randomUUID();
  const stagingDirectory = insideRoot(stagingParent, token);
  const stagedEpub = insideRoot(stagingDirectory, 'book.epub');
  const stagedCover = insideRoot(stagingDirectory, `cover.${coverExtension}`);
  const stagedChapters = insideRoot(stagingDirectory, 'chapters.json');
  const tempCatalog = insideRoot(dataDirectory, `.novels-${token}.tmp`);

  let lockHeld = false;
  let catalogCommitted = false;
  const installedPaths = [];

  try {
    await assertSafeDestination(projectRoot, lockPath);
    await assertSafeDestination(projectRoot, stagingParent);
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error('Another book is being published right now. Wait for it to finish, then try again. If Yomi was closed during a publish, remove tools/publisher/.publish.lock and retry.');
      }
      throw error;
    }
    lockHeld = true;
    const safeChapters = sanitizeChapters(chapters);
    await validatePublication({ id, novel, chapters: safeChapters, epubBytes: epub, coverBytes: cover, root: projectRoot });

    const currentCatalog = await readCatalog(projectRoot);
    // Re-check under the publish lock so two local publisher requests cannot
    // append a stale snapshot or race to claim the same ID.
    if (currentCatalog.some(entry => entry?.id === id)) {
      throw new Error(`The ID “${id}” is already in the shared catalog. Existing files will not be overwritten.`);
    }

    const catalogNovel = createCatalogNovel(novel, safeChapters, epub.byteLength, coverExtension);
    const nextCatalog = [...currentCatalog, catalogNovel];
    const chapterJson = Buffer.from(JSON.stringify(safeChapters, null, 2));
    const nextCatalogJson = Buffer.from(`${JSON.stringify(nextCatalog, null, 2)}\n`);
    checkAssetSize(chapterJson.byteLength, 'Chapter data');
    checkAssetSize(nextCatalogJson.byteLength, 'Shared catalog');
    await assertSafeDestination(projectRoot, stagingDirectory);
    await mkdir(stagingParent, { recursive: true });
    await mkdir(stagingDirectory, { recursive: false });
    await writeFile(stagedEpub, epub, { flag: 'wx' });
    await writeFile(stagedCover, cover, { flag: 'wx' });
    await writeFile(stagedChapters, chapterJson, { flag: 'wx' });

    const destinations = [
      [stagedCover, insideRoot(projectRoot, 'public', 'covers', `${id}.${coverExtension}`)],
      [stagedEpub, insideRoot(projectRoot, 'public', 'epubs', `${id}.epub`)],
      [stagedChapters, insideRoot(projectRoot, 'public', 'data', 'chapters', `${id}.json`)],
    ];
    await assertSafeDestination(projectRoot, epubDirectory);
    await mkdir(epubDirectory, { recursive: true });
    await assertSafeDestination(projectRoot, epubDirectory);
    for (const [, destination] of destinations) {
      await assertSafeDestination(projectRoot, destination);
      if (await exists(destination)) {
        throw new Error(`Cannot publish “${id}”: ${path.relative(projectRoot, destination)} already exists. No existing file was changed.`);
      }
    }
    await assertSafeDestination(projectRoot, catalogPath);

    // Hard-linking each complete staged file creates its public name atomically
    // and with exclusive semantics. A crash before the manifest swap can leave
    // only unreferenced assets; readers never see a partial catalog entry.
    for (const [staged, destination] of destinations) {
      await link(staged, destination);
      installedPaths.push(destination);
    }

    await writeFile(tempCatalog, nextCatalogJson, { flag: 'wx' });
    await rename(tempCatalog, catalogPath);
    catalogCommitted = true;
  } catch (error) {
    if (!catalogCommitted) {
      for (const filePath of installedPaths.reverse()) {
        await rm(filePath, { force: true }).catch(() => {});
      }
      await rm(tempCatalog, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    await assertSafeDestination(projectRoot, stagingDirectory)
      .then(() => rm(stagingDirectory, { recursive: true, force: true }))
      .catch(() => {});
    if (lockHeld) {
      await assertSafeDestination(projectRoot, lockPath)
        .then(() => rm(lockPath, { recursive: true, force: true }))
        .catch(() => {});
    }
  }
}

function createCatalogNovel(novel, chapters, epubSize, coverExtension) {
  const now = Date.now();
  const id = novel.id;
  const epubUrl = `./epubs/${id}.epub`;
  return {
    ...novel,
    cover: `./covers/${id}.${coverExtension}`,
    chapters: chapters.map(({ content: _content, ...chapter }) => chapter),
    downloads: [{
      id: `${id}-complete-epub`,
      novelId: id,
      type: 'complete',
      label: 'Complete EPUB',
      url: epubUrl,
      size: epubSize,
      language: novel.translationLanguage,
    }],
    createdAt: Number.isFinite(novel.createdAt) ? novel.createdAt : now,
    updatedAt: now,
  };
}

function sanitizeChapters(chapters) {
  if (!Array.isArray(chapters)) return chapters;
  return chapters.map(chapter => {
    if (!chapter || typeof chapter !== 'object' || typeof chapter.content !== 'string') return chapter;
    return { ...chapter, content: sanitizeChapterHtml(chapter.content) };
  });
}

function validateId(id) {
  if (typeof id !== 'string' || id.length > 100 || !ID_PATTERN.test(id)) {
    throw new Error('Book ID must be a stable lowercase slug using letters, numbers, and single hyphens (for example, “my-light-novel”).');
  }
}

function requireText(value, label) {
  if (!isNonEmptyString(value)) throw new Error(`${label} is required.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asBytes(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`${label} data is missing or empty.`);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function checkAssetSize(size, label) {
  if (size > MAX_PAGES_ASSET_BYTES) {
    const mib = (size / (1024 * 1024)).toFixed(2);
    const limitMib = (MAX_PAGES_ASSET_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`${label} is ${mib} MiB (${size.toLocaleString('en-US')} bytes), above Cloudflare Pages’ ${limitMib} MiB per-file limit. Compress it or host this asset on a larger-file storage service.`);
  }
}

function detectCoverExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Cover must be a PNG, JPEG, or WebP image so its static filename matches its file format.');
}

async function canonicalRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') throw new Error('A project root is required.');
  return realpath(path.resolve(root));
}

function insideRoot(root, ...segments) {
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access a path outside the project root: ${target}`);
  }
  return target;
}

async function assertSafeDestination(root, destination) {
  insideRoot(root, path.relative(root, destination));
  let cursor = root;
  const parts = path.relative(root, path.dirname(destination)).split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`Refusing to publish through a symbolic link: ${cursor}`);
      if (!info.isDirectory()) throw new Error(`Expected a directory in the publication path: ${cursor}`);
      const real = await realpath(cursor);
      insideRoot(root, path.relative(root, real));
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink()) throw new Error(`Refusing to read or write through a symbolic link: ${destination}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
