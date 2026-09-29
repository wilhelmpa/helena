'use client';

import { useTranslations } from 'next-intl';
import type { CardMetaWords } from '../utils/boardCardData';

// The words of a task's meta line in the reader's language (workItems.card).
export function useCardMetaWords(): CardMetaWords {
  const t = useTranslations('workItems.card');
  return (key, value) => t(key, { value });
}
