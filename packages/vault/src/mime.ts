import path from 'node:path';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.canvas': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.rtf': 'application/rtf',
  '.epub': 'application/epub+zip',
  '.eml': 'message/rfc822',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

export function vaultMime(relative: string): string {
  return MIME_BY_EXTENSION[path.extname(relative).toLowerCase()] ?? 'application/octet-stream';
}

// Files whose text is their content. They are also the files the vault's git history
// tracks (see the .gitignore the setup script writes).
const TEXT_EXTENSIONS = new Set(['.md', '.canvas', '.txt', '.csv', '.json', '.yaml', '.yml']);

export function isTextFile(relative: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase());
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}
