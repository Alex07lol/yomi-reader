import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub, splitChapterParts } from './index';

/* A minimal but valid EPUB: container.xml → content.opf → one XHTML per spine item. */
async function buildEpub(documents: { href: string; html: string }[], title = 'Test Book'): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const manifest = documents.map((doc, i) => `<item id="doc${i}" href="${doc.href}" media-type="application/xhtml+xml"/>`).join('');
  const spine = documents.map((_doc, i) => `<itemref idref="doc${i}"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>Someone</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`);

  for (const doc of documents) zip.file(`OEBPS/${doc.href}`, doc.html);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const doc = (body: string) => `<html><head><title>Whole Book</title></head><body>${body}</body></html>`;
const paragraph = (word: string) => `<p>${word} ${'filler words that make this a real paragraph. '.repeat(3)}</p>`;

describe('EPUB import: reading a book as individual chapters', () => {
  it('splits a single-document EPUB into one chapter per chapter heading', async () => {
    const parsed = await parseEpub(await buildEpub([{
      href: 'book.xhtml',
      html: doc(`
        <h1>Chapter 1</h1>${paragraph('Alpha content')}
        <h1>Chapter 2</h1>${paragraph('Beta content')}
        <h1>Chapter 3</h1>${paragraph('Gamma content')}
      `),
    }]));

    expect(parsed.chapters.map(chapter => chapter.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(parsed.chapters[1].content).toContain('Beta content');
    expect(parsed.chapters[1].content).not.toContain('Alpha content');
    expect(parsed.chapters.every(chapter => chapter.wordCount > 0)).toBe(true);
    expect(parsed.chapters.map(chapter => chapter.order)).toEqual([0, 1, 2]);
  });

  it('leaves a normal one-file-per-chapter EPUB alone', async () => {
    const parsed = await parseEpub(await buildEpub([
      { href: 'c1.xhtml', html: doc(`<h1>Chapter 1</h1>${paragraph('One')}`) },
      { href: 'c2.xhtml', html: doc(`<h1>Chapter 2</h1>${paragraph('Two')}`) },
      { href: 'c3.xhtml', html: doc(`<h1>Chapter 3</h1>${paragraph('Three')}`) },
    ]));

    expect(parsed.chapters.map(chapter => chapter.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(parsed.chapters[2].content).toContain('Three');
  });

  it('keeps a document without chapter headings as a single chapter', async () => {
    const parsed = await parseEpub(await buildEpub([{ href: 'only.xhtml', html: doc(paragraph('Nothing to split')) }]));

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe('Whole Book');
    expect(parsed.chapters[0].content).toContain('Nothing to split');
  });

  it('recognises prose headings, not just the word "chapter"', async () => {
    const parsed = await parseEpub(await buildEpub([{
      href: 'book.xhtml',
      html: doc(`
        <h2>Prologue</h2>${paragraph('Opening')}
        <h2>1</h2>${paragraph('First')}
        <h2>Interlude</h2>${paragraph('Between')}
        <h2>Epilogue</h2>${paragraph('Closing')}
      `),
    }]));

    expect(parsed.chapters.map(chapter => chapter.title)).toEqual(['Prologue', '1', 'Interlude', 'Epilogue']);
  });

  it('folds a repeated heading into the chapter it belongs to instead of inventing an empty one', async () => {
    const html = doc(`<h1>Chapter 5</h1><h1>Chapter 5</h1>${paragraph('Only real text')}`);
    const parsed = await parseEpub(await buildEpub([{ href: 'five.xhtml', html }]));

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe('Chapter 5');
    expect(parsed.chapters[0].content).toContain('Only real text');
  });

  it('absorbs a stub title page but keeps substantial front matter', async () => {
    const stub = await parseEpub(await buildEpub([{
      href: 'book.xhtml',
      html: doc(`<p>iii</p><h1>Chapter 1</h1>${paragraph('Body')}<h1>Chapter 2</h1>${paragraph('More')}`),
    }]));
    expect(stub.chapters.map(chapter => chapter.title)).toEqual(['Chapter 1', 'Chapter 2']);

    // Substantial front matter keeps its own entry, named after the book (the OPF
    // title) — not after the first chapter's heading.
    const substantial = await parseEpub(await buildEpub([{
      href: 'book.xhtml',
      html: doc(`${paragraph('Licensing and translation notes')}<h1>Chapter 1</h1>${paragraph('Body')}<h1>Chapter 2</h1>${paragraph('More')}`),
    }]));
    expect(substantial.title).toBe('Test Book');
    expect(substantial.chapters.map(chapter => chapter.title)).toEqual(['Test Book', 'Chapter 1', 'Chapter 2']);
    expect(substantial.chapters[0].content).toContain('Licensing and translation notes');
  });

  it('still fails loudly when no chapter is readable at all', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container><rootfile full-path="content.opf"/></container>');
    zip.file('content.opf', '<package><manifest></manifest><spine></spine></package>');
    await expect(parseEpub(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/No readable chapters/);
  });
});

describe('splitChapterParts', () => {
  it('requires at least two chapter headings before splitting', () => {
    const once = splitChapterParts(`<h1>Chapter 1</h1><p>${'x'.repeat(200)}</p>`, 'Fallback');
    expect(once).toHaveLength(1);
    expect(once[0].title).toBe('Fallback');

    const twice = splitChapterParts(
      `<h1>Chapter 1</h1><p>${'x'.repeat(200)}</p><h1>Chapter 2</h1><p>${'y'.repeat(200)}</p>`,
      'Fallback',
    );
    expect(twice.map(part => part.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });

  it('does not treat an ordinary sub-heading as a chapter break', () => {
    const parts = splitChapterParts(
      `<h1>Chapter 1</h1><p>${'x'.repeat(200)}</p><h2>A quiet morning</h2><p>${'y'.repeat(200)}</p><h2>Later that day</h2><p>${'z'.repeat(200)}</p>`,
      'Fallback',
    );
    expect(parts).toHaveLength(1);
  });
});
