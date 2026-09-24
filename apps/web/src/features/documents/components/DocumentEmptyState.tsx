import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';

// No note open. "Neue Notiz" is the header row's primary action, so this only says
// what to do.
export default function DocumentEmptyState() {
  const t = useTranslations('documents');
  return <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />;
}
