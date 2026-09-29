import { API_URL, ApiError, request } from '@/lib/api/core/client';
import type { SheetData } from '@/components/common/files/SheetView';

// The preview of a vault file (Auftrag 127): what the server made of an office file with its
// own converter — a PDF of the pages, the sheets of a spreadsheet as rows — and where the
// browser loads it from. Nothing goes to a cloud viewer.
export type FilePreviewKind = 'office' | 'table' | 'text' | 'media' | 'unsupported';

export interface FilePreviewMeta {
  path: string;
  kind: FilePreviewKind;
  mime: string;
  sizeBytes: number;
  sha256: string | null;
  // Set for an office file (the pages as a PDF) …
  pdfUrl?: string;
  // … and for a spreadsheet or a CSV (the sheets as rows).
  tableUrl?: string;
}

const query = (path: string) => new URLSearchParams({ path }).toString();

export const getFilePreview = (vaultPath: string) =>
  request<FilePreviewMeta>(`/knowledge/preview?${query(vaultPath)}`);

export const getPreviewTable = (vaultPath: string) =>
  request<{ path: string; sha256: string; sheets: SheetData[] }>(
    `/knowledge/preview/table?${query(vaultPath)}`,
  );

// The address the browser loads the converted file from: the web app's own route, which
// carries the session to the API (app/protected-media/knowledge/preview/file).
export const previewFileUrl = (vaultPath: string) =>
  `/protected-media/knowledge/preview/file?${query(vaultPath)}`;

// Converts the file (the server keeps the result by the file's hash, so the frame that loads
// it next is quick) and says why it failed: too large (413), damaged (422), busy or not
// running (503), too slow (504).
export async function convertPreviewPdf(vaultPath: string): Promise<void> {
  const response = await fetch(`${API_URL}/knowledge/preview/file?${query(vaultPath)}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; message?: string; code?: string };
      message = body.error ?? body.message ?? message;
      code = body.code;
    } catch {
      // not JSON: the status says enough.
    }
    throw new ApiError(response.status, message, code);
  }
  await response.arrayBuffer();
}
