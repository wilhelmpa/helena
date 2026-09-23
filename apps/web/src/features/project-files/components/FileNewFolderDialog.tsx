import { useTranslations } from 'next-intl';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { childPath } from '@/utils/vaultLinks';
import { useCreateFolder } from '../services/projectFiles.service';
import FileNameDialog from './FileNameDialog';

export default function FileNewFolderDialog({
  scope,
  folder,
  onClose,
}: {
  scope: FileScope;
  folder: string;
  onClose: () => void;
}) {
  const t = useTranslations('files.dialog');
  const create = useCreateFolder(scope);
  return (
    <FileNameDialog
      title={t('newFolder')}
      initialName={t('folderName')}
      submitLabel={t('create')}
      pending={create.isPending}
      onSubmit={(name) => create.mutate(childPath(folder, name), { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}
