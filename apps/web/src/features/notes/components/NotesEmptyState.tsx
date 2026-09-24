'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';

// Shown when a project has no note boards. "Neues Board" is the header row's primary
// action, so the empty state only says what a board is.
export default function NotesEmptyState() {
  const t = useTranslations('notes');
  return <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />;
}
