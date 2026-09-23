import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';

export default function DocumentTrashDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('documents');

  return (
    <ConfirmDialog
      title={t('trashTitle')}
      confirmLabel={t('moveToTrash')}
      onClose={onClose}
      onConfirm={async () => {
        await onConfirm();
        onClose();
      }}
    >
      <p className="text-sm text-muted-foreground" dir="auto">
        {t('trashDescription', { name })}
      </p>
    </ConfirmDialog>
  );
}
