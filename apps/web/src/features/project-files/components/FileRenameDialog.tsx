import { useTranslations } from 'next-intl';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { childPath, parentPath } from '@/utils/vaultLinks';
import { useMoveFile } from '../services/projectFiles.service';
import FileNameDialog from './FileNameDialog';

export default function FileRenameDialog({
  scope,
  item,
  onClose,
}: {
  scope: FileScope;
  item: FileItem;
  onClose: () => void;
}) {
  const t = useTranslations('files.dialog');
  const move = useMoveFile(scope);
  return (
    <FileNameDialog
      title={t('rename')}
      initialName={item.name}
      submitLabel={t('save')}
      pending={move.isPending}
      onSubmit={(name) =>
        move.mutate(
          { from: item.path, to: childPath(parentPath(item.path), name) },
          { onSuccess: onClose },
        )
      }
      onClose={onClose}
    />
  );
}
