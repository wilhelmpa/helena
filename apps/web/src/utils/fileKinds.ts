// How the viewer shows a file, from its name and the content type the api reported.

export type FileViewKind =
  'pdf' | 'image' | 'audio' | 'video' | 'markdown' | 'text' | 'office' | 'other';

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);
const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf']);

// The language highlight.js knows a text file by; absent for plain text.
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  lua: 'lua',
  xml: 'xml',
  html: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  csv: 'plaintext',
  dockerfile: 'dockerfile',
};

const TEXT_EXTENSIONS = new Set([
  ...Object.keys(LANGUAGES).filter((extension) => !['html', 'svg', 'xml'].includes(extension)),
  'txt',
  'log',
  'env',
  'cfg',
  'properties',
  'srt',
  'vtt',
  'tex',
  'ics',
]);

export function fileViewKind(name: string, contentType?: string | null): FileViewKind {
  const extension = extensionOf(name);
  const type = contentType ?? '';
  if (extension === 'pdf' || type === 'application/pdf') return 'pdf';
  if (IMAGES.has(extension) || /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type)) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (TEXT_EXTENSIONS.has(extension) || type.startsWith('text/plain')) return 'text';
  if (OFFICE.has(extension)) return 'office';
  return 'other';
}

export const highlightLanguage = (name: string): string | undefined => LANGUAGES[extensionOf(name)];
