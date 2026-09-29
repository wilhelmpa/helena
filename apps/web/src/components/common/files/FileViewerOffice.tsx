'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from '@/lib/api/core/client';
import {
  convertPreviewPdf,
  getFilePreview,
  getPreviewTable,
  previewFileUrl,
} from '@/lib/api/endpoints/filePreview';
import { extractedText } from '@/lib/api/endpoints/projectFiles';
import { Segmented, Text } from '@/design-system';
import FileViewerFallback from './FileViewerFallback';
import SheetView from './SheetView';
import type { ViewerFile } from './FileViewer';

// Why the converter gave nothing, in words (the status is the converter's, Auftrag 127).
function problemKey(error: unknown): 'tooLarge' | 'damaged' | 'busy' | 'timeout' | 'unavailable' {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 413) return 'tooLarge';
  if (status === 422) return 'damaged';
  if (status === 503 && error instanceof ApiError && error.code === 'preview_busy') return 'busy';
  if (status === 504) return 'timeout';
  return 'unavailable';
}

// Where the converter cannot help, what the vault index extracted from the file (a text
// without layout), and a file with neither has the download — never an empty box.
function ExtractedOrFallback({ file, reason }: { file: ViewerFile; reason?: string }) {
  const t = useTranslations('files.viewer');
  const text = useQuery({
    queryKey: ['files', 'extracted', file.vaultPath],
    queryFn: () => extractedText(file.vaultPath!),
    enabled: file.vaultPath !== null,
    retry: false,
  });
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
        reason={reason ?? t('noExtracted')}
      />
    );
  return (
    <div className="ds-file-text">
      <Text as="p" size="xs" tone="muted">
        {[t('extracted'), reason].filter(Boolean).join(' · ')}
      </Text>
      <p className="ds-file-text-body" dir="auto">
        {text.data}
      </p>
    </div>
  );
}

function OfficePages({ file, sha }: { file: ViewerFile; sha: string | null }) {
  const t = useTranslations('files.viewer');
  const vaultPath = file.vaultPath!;
  // The conversion runs when the file is asked for; the frame loads the finished PDF.
  const converted = useQuery({
    queryKey: ['files', 'preview-pdf', vaultPath, sha],
    queryFn: () => convertPreviewPdf(vaultPath),
    retry: false,
    staleTime: Infinity,
  });
  if (converted.isPending)
    return (
      <Text as="p" size="sm" tone="muted" role="status">
        {t('converting')}
      </Text>
    );
  if (converted.isError)
    return (
      <ExtractedOrFallback file={file} reason={t(`problems.${problemKey(converted.error)}`)} />
    );
  return <iframe src={previewFileUrl(vaultPath)} title={file.name} className="ds-file-embed" />;
}

function OfficeSheets({ file, sha }: { file: ViewerFile; sha: string | null }) {
  const t = useTranslations('files.viewer');
  const table = useQuery({
    queryKey: ['files', 'preview-table', file.vaultPath, sha],
    queryFn: () => getPreviewTable(file.vaultPath!),
    retry: false,
    staleTime: Infinity,
  });
  if (table.isPending)
    return (
      <Text as="p" size="sm" tone="muted" role="status">
        {t('converting')}
      </Text>
    );
  if (table.isError)
    return <ExtractedOrFallback file={file} reason={t(`problems.${problemKey(table.error)}`)} />;
  return <SheetView sheets={table.data.sheets} />;
}

// An office file (Word, Excel, PowerPoint and their open formats), shown by the server's own
// converter (LibreOffice on this server, no cloud viewer): documents and slides as their
// pages (a PDF), a spreadsheet as its sheets — with its pages one click away. Where that
// does not work (not running, too large, damaged, too slow) the text the vault index
// extracted stands in, with the reason, and a file with neither has the download.
export default function FileViewerOffice({ file }: { file: ViewerFile }) {
  const t = useTranslations('files.viewer');
  const [view, setView] = useState<'table' | 'pages'>('table');
  const meta = useQuery({
    queryKey: ['files', 'preview', file.vaultPath],
    queryFn: () => getFilePreview(file.vaultPath!),
    enabled: file.vaultPath !== null,
    retry: false,
  });
  if (file.vaultPath === null) return <ExtractedOrFallback file={file} />;
  if (meta.isPending)
    return (
      <Text as="p" size="sm" tone="muted" role="status">
        {t('loading')}
      </Text>
    );
  if (meta.isError)
    return <ExtractedOrFallback file={file} reason={t(`problems.${problemKey(meta.error)}`)} />;
  const sha = meta.data.sha256;
  if (!meta.data.tableUrl) return <OfficePages file={file} sha={sha} />;
  return (
    <div className="ds-file-office">
      <Segmented
        className="self-start"
        label={t('view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: t('table') },
          { value: 'pages', label: t('pages') },
        ]}
      />
      {view === 'table' ? (
        <OfficeSheets file={file} sha={sha} />
      ) : (
        <OfficePages file={file} sha={sha} />
      )}
    </div>
  );
}
