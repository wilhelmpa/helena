import type { StorageSettings } from '@/lib/api/endpoints/settings';

// Client-side mirror of the api's upload checks (apps/api/src/attachments/routes.ts).
// The api enforces the real limits; these helpers state them in the UI and reject an
// oversized or unaccepted file before it is sent.

const MB = 1024 * 1024;

// The `accept` attribute for a file input, or undefined when any type is allowed.
export function attachmentAccept(limits: StorageSettings | undefined): string | undefined {
  const types = limits?.attachmentMimeTypes ?? [];
  return types.length > 0 ? types.join(',') : undefined;
}

// Plain names for the MIME types an instance can accept, as message keys under
// common.uploadLimits.types. Several types share one name (a .doc, a .docx and an
// .odt are all documents), so the hint stays short.
const TYPE_NAMES: Record<string, UploadTypeName> = {
  'image/*': 'images',
  'video/*': 'video',
  'audio/*': 'audio',
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/csv': 'csv',
  'text/markdown': 'markdown',
  'application/msword': 'documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'documents',
  'application/vnd.oasis.opendocument.text': 'documents',
  'application/vnd.ms-excel': 'spreadsheets',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheets',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheets',
  'application/vnd.ms-powerpoint': 'presentations',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentations',
  'application/vnd.oasis.opendocument.presentation': 'presentations',
};

export type UploadTypeName =
  | 'images'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'csv'
  | 'markdown'
  | 'documents'
  | 'spreadsheets'
  | 'presentations';

// The words the hint and the errors are made of, in the reader's language
// (useUploadLimitText below supplies them from common.uploadLimits).
export interface UploadLimitWords {
  maxSize: (mb: number) => string;
  accepted: (types: string) => string;
  typeName: (name: UploadTypeName) => string;
  tooLarge: (name: string, mb: number) => string;
  notAccepted: (name: string) => string;
}

// A type with no entry above falls back to its last segment ("application/zip" reads
// as "ZIP"), which is closer to what people call the file than the full MIME type.
function typeName(mimeType: string, words: UploadLimitWords): string {
  const type = mimeType.trim().toLowerCase();
  const known = TYPE_NAMES[type];
  if (known) return words.typeName(known);
  const subtype = type.split('/')[1] ?? type;
  return subtype.split('.').pop()!.toUpperCase();
}

// The sentence shown next to the picker: the size limit, plus the accepted types
// when the instance restricts them.
export function attachmentLimitHint(
  limits: StorageSettings | undefined,
  words: UploadLimitWords,
): string {
  if (!limits) return '';
  const size = words.maxSize(limits.maxAttachmentMb);
  const names = [...new Set(limits.attachmentMimeTypes.map((type) => typeName(type, words)))];
  return names.length > 0 ? `${size} ${words.accepted(names.join(', '))}` : size;
}

// The reason a file cannot be uploaded, or null when it passes.
export function attachmentError(
  file: File,
  limits: StorageSettings | undefined,
  words: UploadLimitWords,
): string | null {
  if (!limits) return null;
  if (file.size > limits.maxAttachmentMb * MB) {
    return words.tooLarge(file.name, limits.maxAttachmentMb);
  }
  const types = limits.attachmentMimeTypes;
  if (types.length > 0) {
    const ct = (file.type || '').toLowerCase();
    const ok = types.some((entry) => {
      const pattern = entry.trim().toLowerCase();
      return pattern.endsWith('/*') ? ct.startsWith(pattern.slice(0, -1)) : ct === pattern;
    });
    if (!ok) return words.notAccepted(file.name);
  }
  return null;
}
