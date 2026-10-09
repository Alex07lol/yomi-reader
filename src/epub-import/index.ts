/* ─── EPUB Ingestion / Import Architecture ───

   Conceptual workflow:
     Upload EPUB → Parse → Extract metadata → Detect chapters & volumes
     → Create novel record → Review metadata → Publish

   This module provides the parsing pipeline for the admin/import side.
   No UI is included — it is a pure data layer ready to be wired
   to a file input or drag-and-drop zone.
*/

import JSZip from 'jszip';
import { sanitizeChapterHtml } from '../utils/sanitize-chapter-html.mjs';

/* ── Parsed EPUB result ── */

export interface ParsedEpub {
  /** Suggested novel id (slugified title) */
  suggestedId: string;
  /** Title from OPF metadata */
  title: string;
  /** Author from OPF metadata */
  author: string;
  /** Language code from OPF */
  language: string;
  /** Description from OPF or first <meta name="description"> */
  description: string;
  /** Cover image base64 (from cover-image or first image) */
  coverDataUrl?: string;
  /** Chapters extracted from spine */
  chapters: ParsedChapter[];
  /** Raw OPF metadata for admin override */
  rawMetadata: Record<string, string>;
}

export interface ParsedChapter {
  /** Stable chapter id derived from filename/title */
  id: string;
  title: string;
  /** HTML content (sanitised) */
  content: string;
  wordCount: number;
  /** Order in spine */
  order: number;
}

/* ── Parse an ArrayBuffer from an .epub file ── */

export async function parseEpub(arrayBuffer: ArrayBuffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  /* ── Read container.xml to find root.opf ── */
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Invalid EPUB: no META-INF/container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) throw new Error('Invalid EPUB: no root.opf reference');
  const opfPath = opfMatch[1];

  /* ── Read OPF metadata ── */
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('Invalid EPUB: cannot read root.opf');
  const packageDirectory = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const resolveArchivePath = (href: string): string => {
    const decoded = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
    const segments = decoded.startsWith('/') ? [] : packageDirectory.split('/').filter(Boolean);
    for (const segment of decoded.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment);
    }
    return segments.join('/');
  };

  const metadata = extractOpfMetadata(opfXml);
  const title = metadata['dc:title'] ?? metadata['title'] ?? 'Untitled';
  const author = metadata['dc:creator'] ?? metadata['creator'] ?? 'Unknown';
  const language = metadata['dc:language'] ?? metadata['language'] ?? 'en';
  const description = metadata['dc:description'] ?? metadata['description'] ?? '';

  /* ── Read spine to find chapter files ── */
  const spineMatch = opfXml.match(/<(?:[\w.-]+:)?spine\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?spine>/i);
  if (!spineMatch) throw new Error('Invalid EPUB: no spine in OPF');

  const readAttribute = (source: string, name: string): string | undefined => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return source.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
  };

  const idrefRe = /<(?:[\w.-]+:)?itemref\b([^>]*)>/gi;
  const idrefs: string[] = [];
  const navigationIds = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = idrefRe.exec(spineMatch[1])) !== null) {
    const idref = readAttribute(m[1], 'idref');
    if (idref) idrefs.push(idref);
  }
  const manifestMatch = opfXml.match(/<(?:[\w.-]+:)?manifest\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?manifest>/i);
  const itemIdToHref: Record<string, string> = {};
  let coverImageHref: string | undefined;
  if (manifestMatch) {
    const itemRe = /<(?:[\w.-]+:)?item\b([^>]*)>/gi;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(manifestMatch[1])) !== null) {
      const itemId = readAttribute(im[1], 'id');
      const href = readAttribute(im[1], 'href');
      if (!itemId || !href) continue;
      itemIdToHref[itemId] = resolveArchivePath(href);
      const properties = readAttribute(im[1], 'properties')?.split(/\s+/) ?? [];
      if (properties.includes('nav')) navigationIds.add(itemId);
      if (properties.includes('cover-image')) {
        coverImageHref = itemIdToHref[itemId];
      }
    }
  }
  const chapterIdrefs = idrefs.filter(idref => !navigationIds.has(idref));

  /* Find cover image id */
  let coverId: string | undefined;
  for (const meta of opfXml.matchAll(/<(?:[\w.-]+:)?meta\b([^>]*)>/gi)) {
    if (readAttribute(meta[1], 'name')?.toLowerCase() === 'cover') {
      coverId = readAttribute(meta[1], 'content');
      break;
    }
  }
  const coverHref = (coverId ? itemIdToHref[coverId] : undefined) ?? coverImageHref;

  /* ── Extract chapters ── */
  const chapters: ParsedChapter[] = [];
  for (const idref of chapterIdrefs) {
    const href = itemIdToHref[idref];
    if (!href) continue;
    const file = zip.file(href);
    if (!file) continue;

    const html = await file.async('string');
    const { title: chTitle, content: cleanHtml } = extractChapterContent(html);
    const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    chapters.push({
      id: `epub-ch-${chapters.length + 1}-${slugify(chTitle)}`,
      title: chTitle,
      content: cleanHtml,
      wordCount: textContent.split(/\s+/).length,
      order: chapters.length,
    });
  }

  if (chapters.length === 0) {
    throw new Error('No readable chapters were found in this EPUB. Check that its package manifest and reading order are valid.');
  }

  /* ── Cover image ── */
  let coverDataUrl: string | undefined;
  if (coverHref) {
    const coverFile = zip.file(coverHref);
    if (coverFile) {
      const coverBlob = await coverFile.async('blob');
      coverDataUrl = await blobToDataUrl(coverBlob);
    }
  }

  return {
    suggestedId: slugify(title),
    title,
    author,
    language,
    description,
    coverDataUrl,
    chapters,
    rawMetadata: metadata,
  };
}

/* ── Extract OPF key/value pairs ── */

function extractOpfMetadata(opfXml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /<dc:(\w+)[^>]*>([^<]+)<\/dc:\w+>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(opfXml)) !== null) {
    result[`dc:${m[1]}`] = m[2].trim();
  }
  /* Also capture bare metadata names */
  const bareRe = /<meta\s+name\s*=\s*"([^"]+)"[^>]*content\s*=\s*"([^"]*)"/gi;
  while ((m = bareRe.exec(opfXml)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

/* ── Extract chapter title and sanitised content ── */

function extractChapterContent(html: string): { title: string; content: string } {
  /* Try <title> tag */
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const headingMatch = html.match(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/i);
  const headingTitle = headingMatch?.[1].match(/\btitle\s*=\s*(["'])(.*?)\1/i)?.[2];
  const decodeTitle = (value: string) => value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] ?? _match))
    .replace(/\s+/g, ' ')
    .trim();
  const title = [titleMatch?.[1], headingTitle, headingMatch?.[2]]
    .map(value => value ? decodeTitle(value) : '')
    .find(value => value.length > 0) ?? 'Untitled Chapter';

  /* Extract body content */
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  return { title, content: sanitizeChapterHtml(bodyHtml) };
}

/* ── Utility: blob → data URL ── */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ── Utility: slugify ── */

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* ── For future: detect volumes from OPF groups or filename patterns ── */

export interface VolumeDetection {
  /** Map of volume label → chapter indices */
  volumes: Record<string, number[]>;
}

export function detectVolumes(chapters: ParsedChapter[], countPerVolume: number = 10): VolumeDetection {
  const volumes: Record<string, number[]> = {};
  chapters.forEach((_ch, i) => {
    const volNum = Math.floor(i / countPerVolume) + 1;
    const key = `Volume ${volNum}`;
    if (!volumes[key]) volumes[key] = [];
    volumes[key].push(i);
  });
  return { volumes };
}
