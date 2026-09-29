'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Text } from '@/design-system';
import { detectDelimiter, parseDelimited } from './delimited';
import SheetView from './SheetView';

const MAX_TABLE_BYTES = 5 * 1024 * 1024;

// A CSV or TSV file as a table.
export default function FileViewerTable({
  url,
  name,
  sizeBytes,
}: {
  url: string;
  name: string;
  sizeBytes: number | null;
}) {
  const t = useTranslations('files.viewer');
  const tooLarge = sizeBytes !== null && sizeBytes > MAX_TABLE_BYTES;
  const text = useQuery({
    queryKey: ['files', 'text', url],
    queryFn: async () => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      return res.text();
    },
    enabled: !tooLarge,
    retry: false,
  });
  const rows = useMemo(
    () =>
      text.data === undefined ? [] : parseDelimited(text.data, detectDelimiter(text.data, name)),
    [text.data, name],
  );
  if (tooLarge)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('tooLarge')}
      </Text>
    );
  if (text.isPending)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('loading')}
      </Text>
    );
  if (text.isError)
    return (
      <Text as="p" size="sm" tone="danger">
        {t('error')}
      </Text>
    );
  return <SheetView sheets={[{ name, rows }]} />;
}
