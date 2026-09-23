import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { useTrashFile } from '../services/projectFiles.service';

export default function FileTrashDialog({
  scope,
  item,
  onClose,
}: {
  scope: FileScope;
  item: FileItem;
  onClose: () => void;
}) {
  const t = useTranslations('files');
  const trash = useTrashFile(scope);
  return (
    <Modal
      title={t('trashDialog.title', { name: item.name })}
      description={t('trashDialog.description')}
      onClose={onClose}
    >
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button
          variant="destructive"
          disabled={trash.isPending}
          onClick={() =>
            trash.mutate(item.path, {
              onSuccess: () => {
                toast.success(t('trashed', { name: item.name }));
                onClose();
              },
            })
          }
        >
          {t('trashDialog.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
