'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Text } from '@/design-system';
import { extractedText } from '@/lib/api/endpoints/projectFiles';
import FileViewerFallback from './FileViewerFallback';
import SheetView, { type SheetData } from './SheetView';
import type { ViewerFile } from './FileViewer';

// What the server's converter made of an office file (LibreOffice on the server, no cloud
// viewer): a PDF of the pages, or the sheets of a spreadsheet as rows.
export type OfficePreview =
  { kind: 'pdf'; url: string } | { kind: 'sheets'; sheets: SheetData[]; pdfUrl?: string };

// An office file (Word, Excel, PowerPoint and their open formats). Converted, it is shown
// as a PDF or a table; until the converter has it, the text the vault index extracted is
// shown, and a file with neither has the download (never an empty box).
export default function FileViewerOffice({
  file,
  preview = null,
}: {
  file: ViewerFile;
  preview?: OfficePreview | null;
}) {
  const t = useTranslations('files.viewer');
  const text = useQuery({
    queryKey: ['files', 'extracted', file.vaultPath],
    queryFn: () => extractedText(file.vaultPath!),
    enabled: file.vaultPath !== null && preview === null,
    retry: false,
  });
  if (preview?.kind === 'pdf')
    return <iframe src={preview.url} title={file.name} className="ds-file-embed" />;
  if (preview?.kind === 'sheets') return <SheetView sheets={preview.sheets} />;
  if (file.vaultPath !== null && text.isPending)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('loading')}
      </Text>
    );
  if (!text.data)
    return (
      <FileViewerFallback
        name={file.name}
        contentType={file.contentType}
        sizeBytes={file.sizeBytes}
        url={file.url}
        reason={t('noExtracted')}
      />
    );
  return (
    <div className="ds-file-text">
      <Text as="p" size="xs" tone="muted">
        {t('extracted')}
      </Text>
      <p className="ds-file-text-body" dir="auto">
        {text.data}
      </p>
    </div>
  );
}
