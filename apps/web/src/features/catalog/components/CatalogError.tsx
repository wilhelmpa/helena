'use client';

import { OctagonAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Box, Notice, Text } from '@/design-system';
import { catalogErrorKey } from '../utils/catalogErrors';

// What went wrong with a catalog action, in the reader's language (the API answers in
// English), as a notice in place; nothing when there was no error.
export default function CatalogError({
  error,
  compact = false,
}: {
  error: unknown;
  // One quiet line under a row instead of a notice card (a list where several rows can fail).
  compact?: boolean;
}) {
  const t = useTranslations('catalog.errors');
  if (!error) return null;
  const key = catalogErrorKey(error);
  if (compact)
    return (
      <Box padX={3} padBottom={2}>
        <Text size="xs" tone="danger" role="alert">
          {t(`${key}.title` as never)}. {t(`${key}.text` as never)}
        </Text>
      </Box>
    );
  return (
    <Notice tone="danger" icon={<OctagonAlert />} title={t(`${key}.title` as never)}>
      {t(`${key}.text` as never)}
    </Notice>
  );
}
