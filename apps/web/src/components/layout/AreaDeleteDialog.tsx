import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { countViewFolderFiles } from '@/lib/api/endpoints/views';

export default function AreaDeleteDialog({
  id,
  name,
  onConfirm,
  onClose,
}: {
  id: number;
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('views');
  const count = useQuery({
    queryKey: ['view-folder-file-count', id],
    queryFn: () => countViewFolderFiles(id),
    staleTime: 0,
  });

  return (
    <ConfirmDialog
      title={t('deleteFolder')}
      confirmLabel={t('deleteFolder')}
      confirmDisabled={!count.isSuccess || count.isFetching}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-sm text-muted-foreground">{t('deleteFolderConfirm', { name })}</p>
      {count.isPending && <p className="text-sm">{t('deleteFolderCountLoading')}</p>}
      {count.isError && <p className="text-sm text-destructive">{t('deleteFolderCountError')}</p>}
      {count.data && count.data.count > 0 && (
        <p className="text-sm text-destructive">
          {t('deleteFolderFileWarning', { count: count.data.count })}
        </p>
      )}
    </ConfirmDialog>
  );
}
