import { FilePlus2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';

export default function DocumentEmptyState({
  canEdit,
  creating,
  onNewNote,
}: {
  canEdit: boolean;
  creating: boolean;
  onNewNote: () => void;
}) {
  const t = useTranslations('documents');

  return (
    <EmptyState title={t('emptyTitle')} description={t('emptyDescription')}>
      {canEdit && (
        <Button size="sm" disabled={creating} onClick={onNewNote}>
          <FilePlus2 />
          {t('newNote')}
        </Button>
      )}
    </EmptyState>
  );
}
