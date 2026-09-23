import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import FilePickerDialog from '@/components/common/files/FilePickerDialog';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { baseName, childPath, parentPath } from '@/utils/vaultLinks';
import { useMoveFile } from '../services/projectFiles.service';

// Moves an entry into the folder picked in the scope. A folder cannot be moved into itself.
export default function FileMoveDialog({
  scope,
  item,
  onClose,
}: {
  scope: FileScope;
  item: FileItem;
  onClose: () => void;
}) {
  const t = useTranslations('files');
  const move = useMoveFile(scope);
  return (
    <FilePickerDialog
      scope={scope}
      mode="folder"
      title={t('moveDialog.title', { name: item.name })}
      description={t('moveDialog.description')}
      confirmLabel={t('moveDialog.here')}
      initialPath={parentPath(item.path)}
      disabledPath={item.kind === 'folder' ? item.path : undefined}
      onPick={(target) =>
        move.mutate(
          { from: item.path, to: childPath(target, item.name) },
          {
            onSuccess: () => {
              toast.success(t('moved', { folder: target ? baseName(target) : '/' }));
              onClose();
            },
          },
        )
      }
      onClose={onClose}
    />
  );
}
