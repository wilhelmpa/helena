'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ButtonAnchor, EmptyState } from '@/design-system';
import { formatSize } from '@/utils/fileSize';
import FileKindIcon from './FileKindIcon';

// A file Ava cannot show: its symbol, its name, what it is and how large, and the way to
// take it (download) — never an empty box (owner 29.09., O76).
export default function FileViewerFallback({
  name,
  contentType,
  sizeBytes,
  url,
  reason,
}: {
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  url: string;
  // Why there is no preview, when it is not simply the kind of file.
  reason?: string;
}) {
  const t = useTranslations('files.viewer');
  const meta = [contentType, sizeBytes !== null ? formatSize(sizeBytes) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <EmptyState
      fill={false}
      icon={<FileKindIcon name={name} contentType={contentType} />}
      title={name}
      action={
        <ButtonAnchor href={url} download={name} icon={<Download size={15} aria-hidden="true" />}>
          {t('download')}
        </ButtonAnchor>
      }
    >
      {[meta, reason ?? t('noPreview')].filter(Boolean).join(' · ')}
    </EmptyState>
  );
}
