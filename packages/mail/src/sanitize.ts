import sanitizeHtml from 'sanitize-html';

export interface SanitizedHtml {
  html: string;
  hasRemoteImages: boolean;
}

const EXTRA_TAGS = ['img', 'center', 'font', 'big', 'strike'];
const TABLE_ATTRIBUTES = ['width', 'height', 'bgcolor', 'align', 'valign', 'border', 'nowrap'];
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import/i;

function isRemote(src: string): boolean {
  return /^(https?:)?\/\//i.test(src.trim());
}

function safeStyle(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const kept = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !UNSAFE_STYLE.test(declaration));
  return kept.length > 0 ? kept.join('; ') : undefined;
}

function withStyle(attribs: Record<string, string>): Record<string, string> {
  const style = safeStyle(attribs.style);
  const { style: _dropped, ...rest } = attribs;
  return style ? { ...rest, style } : rest;
}

// Mail HTML is untrusted. Scripts, forms, frames and stylesheets are removed, links
// open in a new tab, and a remote image keeps its address in data-remote-src instead
// of src, so it loads only after the owner allows remote images for that message.
// cid: images stay as they are; the API rewrites them to its own URL when it serves
// the message.
export function sanitizeMailHtml(html: string): SanitizedHtml {
  let hasRemoteImages = false;
  const output = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, ...EXTRA_TAGS],
    nonBooleanAttributes: sanitizeHtml.defaults.nonBooleanAttributes.filter(
      (name) => name !== 'hidden',
    ),
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head'],
    allowedAttributes: {
      '*': [
        'style',
        'align',
        'valign',
        'dir',
        'lang',
        'title',
        'width',
        'height',
        'bgcolor',
        'hidden',
        'aria-hidden',
      ],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'border', 'data-remote-src'],
      font: ['color', 'face', 'size'],
      table: [...TABLE_ATTRIBUTES, 'cellpadding', 'cellspacing'],
      td: [...TABLE_ATTRIBUTES, 'colspan', 'rowspan'],
      th: [...TABLE_ATTRIBUTES, 'colspan', 'rowspan'],
      tr: TABLE_ATTRIBUTES,
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['cid', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attribs) => ({ tagName, attribs: withStyle(attribs) }),
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...withStyle(attribs), target: '_blank', rel: 'noopener noreferrer' },
      }),
      img: (tagName, attribs) => {
        const { src = '', 'data-remote-src': _ignored, ...rest } = withStyle(attribs);
        if (!isRemote(src)) return { tagName, attribs: { ...rest, src } };
        hasRemoteImages = true;
        const remote = src.trim().startsWith('//') ? `https:${src.trim()}` : src.trim();
        return { tagName, attribs: { ...rest, 'data-remote-src': remote } };
      },
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !frame.attribs.src && !frame.attribs['data-remote-src'],
  });
  return { html: output, hasRemoteImages };
}

// Turns the blocked remote images of sanitized HTML back into loading ones.
export function allowRemoteImages(html: string): string {
  return html.replace(/<img\b([^>]*?)\sdata-remote-src="([^"]*)"/gi, '<img$1 src="$2"');
}

// Points every cid: image of sanitized HTML at the URL the caller serves the part from.
export function resolveCidImages(html: string, url: (contentId: string) => string): string {
  return html.replace(
    /(<img\b[^>]*?\ssrc=")cid:([^"]*)"/gi,
    (_match, head: string, cid: string) => {
      return `${head}${url(decodeEntities(cid))}"`;
    },
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The HTML part of a mail whose body is plain text: paragraphs, line breaks, and
// runs of "> " lines as a quote.
export function plainTextHtml(text: string): string {
  const out: string[] = [];
  let lines: string[] = [];
  let quoted: string[] = [];
  const flushLines = () => {
    if (lines.some((line) => line.trim())) out.push(`<p>${lines.map(escapeHtml).join('<br>')}</p>`);
    lines = [];
  };
  const flushQuote = () => {
    if (quoted.length > 0) out.push(`<blockquote>${plainTextHtml(quoted.join('\n'))}</blockquote>`);
    quoted = [];
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('>')) {
      flushLines();
      quoted.push(line.replace(/^> ?/, ''));
    } else if (!line.trim()) {
      flushLines();
      flushQuote();
    } else {
      flushQuote();
      lines.push(line);
    }
  }
  flushLines();
  flushQuote();
  return out.join('');
}
