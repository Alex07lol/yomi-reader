import sanitizeHtml from 'sanitize-html';

const safeRasterDataUrl = /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/]+=*$/i;

const options = {
  allowedTags: [
    'a', 'address', 'article', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'div', 'dl', 'dt',
    'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'main', 'mark',
    'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    ol: ['start', 'type'],
    li: ['value'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto', 'tel'],
    img: ['data'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  allowProtocolRelative: false,
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'noembed', 'noframes', 'plaintext', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'audio', 'video'],
  exclusiveFilter(frame) {
    return frame.tag === 'img' && !safeRasterDataUrl.test(frame.attribs.src || '');
  },
};

/** Sanitize untrusted EPUB chapter markup to the small set of reader-safe HTML elements. */
export function sanitizeChapterHtml(html) {
  return sanitizeHtml(typeof html === 'string' ? html : '', options);
}
