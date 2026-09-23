import { useTranslations } from 'next-intl';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { childPath } from '@/utils/vaultLinks';
import { useCreateTextFile } from '../services/projectFiles.service';
import FileNameDialog from './FileNameDialog';

const NOTE_EXTENSION = /\.(md|markdown|txt)$/i;

// A new empty note, opened once it exists. A name without an extension becomes Markdown.
export default function FileNewNoteDialog({
  scope,
  folder,
  onCreated,
  onClose,
}: {
  scope: FileScope;
  folder: string;
  onCreated: (path: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('files.dialog');
  const create = useCreateTextFile(scope);
  return (
    <FileNameDialog
      title={t('newFile')}
      hint={t('fileHint')}
      initialName={t('fileName')}
      submitLabel={t('create')}
      pending={create.isPending}
      onSubmit={(name) => {
        const path = childPath(folder, NOTE_EXTENSION.test(name) ? name : `${name}.md`);
        create.mutate(
          { path, content: '' },
          {
            onSuccess: (created) => {
              onClose();
              onCreated(created.path);
            },
          },
        );
      }}
      onClose={onClose}
    />
  );
}
