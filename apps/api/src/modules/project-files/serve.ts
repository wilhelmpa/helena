import { stat } from 'node:fs/promises';
import path from 'node:path';

const TEXT = 'text/plain; charset=utf-8';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.eml': 'message/rfc822',
  '.ics': 'text/calendar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

// Plain text the viewer shows with highlighting. Served as text/plain, so a browser
// never runs any of it.
const TEXT_EXTENSIONS = new Set(
  (
    '.txt .log .ini .conf .cfg .env .toml .yml .yaml .sh .bash .zsh .ps1 .bat .py .rb .php ' +
    '.js .mjs .cjs .jsx .ts .tsx .css .scss .less .sql .go .rs .java .kt .kts .swift .c .h ' +
    '.cpp .hpp .cs .lua .r .pl .dockerfile .gradle .properties .diff .patch .tex .srt .vtt'
  ).split(' '),
);

export function contentTypeOf(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return TEXT;
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

const isText = (contentType: string) =>
  /^text\/(plain|markdown|csv|calendar)\b/i.test(contentType) || contentType === 'application/json';

// What the Files viewer opens in the browser: PDF in its own viewer (which does not
// open under a sandbox policy), raster images, audio and video, and text as text/plain.
// HTML, SVG and everything else that can carry script is always a sandboxed download.
export const VIEWER_INLINE = (contentType: string) =>
  contentType === 'application/pdf' ||
  /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(contentType) ||
  /^(audio|video)\//i.test(contentType) ||
  isText(contentType);

// The public raw route of an attachment keeps its narrower list: media a page embeds.
export const ATTACHMENT_INLINE = (contentType: string) =>
  /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/|audio\/)/i.test(contentType);

function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Math.min(Number(match[2]), size);
    return { start: size - length, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return { start, end };
}

// Streams one file with the headers that keep its bytes inert, and answers a single
// byte range so audio and video can seek.
export async function serveFile(input: {
  file: string;
  filename: string;
  contentType: string;
  request: Request;
  download: boolean;
  inline: (contentType: string) => boolean;
}): Promise<Response> {
  const info = await stat(input.file);
  // A file replaced in place is a new inode, so the tag changes even at the same size.
  const etag = `W/"${[info.ino, info.size, Math.floor(info.mtimeMs)].map((n) => n.toString(36)).join('-')}"`;
  const inline = !input.download && input.inline(input.contentType);
  const headers: Record<string, string> = {
    'Content-Type': inline && isText(input.contentType) ? TEXT : input.contentType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(input.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache',
    'Accept-Ranges': 'bytes',
    ETag: etag,
  };
  if (!inline) headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
  if (input.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const file = Bun.file(input.file);
  const range = byteRange(input.request.headers.get('range'), info.size);
  if (!range) {
    headers['Content-Length'] = String(info.size);
    return new Response(file.stream(), { headers });
  }
  if (range.start > range.end || range.start >= info.size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${info.size}` },
    });
  }
  headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
  headers['Content-Length'] = String(range.end - range.start + 1);
  return new Response(file.slice(range.start, range.end + 1).stream(), { status: 206, headers });
}
