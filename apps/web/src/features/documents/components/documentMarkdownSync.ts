import type { DocumentMarkdownSyncState } from '@/lib/api/endpoints/documents';

export type DocumentMarkdownSyncPresentation = {
  labelKey: 'synced' | 'pending' | 'privateNotExported';
  hintKey: 'syncedHint' | 'pendingHint' | 'privateHint';
  canOpenFiles: boolean;
  canRetry: boolean;
};

export function documentMarkdownPath(documentId: number): string {
  return `Dokumente/Plan/doc-${documentId}.md`;
}

export function documentMarkdownSyncPresentation(
  state: DocumentMarkdownSyncState,
): DocumentMarkdownSyncPresentation {
  switch (state) {
    case 'synced':
      return {
        labelKey: 'synced',
        hintKey: 'syncedHint',
        canOpenFiles: true,
        canRetry: false,
      };
    case 'private_not_exported':
      return {
        labelKey: 'privateNotExported',
        hintKey: 'privateHint',
        canOpenFiles: false,
        canRetry: false,
      };
    case 'pending':
      return {
        labelKey: 'pending',
        hintKey: 'pendingHint',
        canOpenFiles: false,
        canRetry: true,
      };
  }
}
