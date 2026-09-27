import { stat } from 'node:fs/promises';
import { mimeFromName } from '@repo/storage/mime';

const TEXT = 'text/plain; charset=utf-8';

// The type comes from the shared MIME module; the text types a viewer shows get their
// charset, and source code is text/plain there, so a browser never runs any of it.
export function contentTypeOf(filename: string): string {
  const type = mimeFromName(filename);
  return /^text\/(plain|markdown|csv)$/.test(type) ? `${type}; charset=utf-8` : type;
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
