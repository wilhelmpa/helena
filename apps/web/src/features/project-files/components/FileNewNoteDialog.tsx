import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getPropertiesTemplate } from '@/lib/api/endpoints/knowledge';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { vaultFilePath } from '../utils/vaultFilePath';
import { childPath } from '@/utils/vaultLinks';
import { useCreateTextFile } from '../services/projectFiles.service';
import FileNameDialog from './FileNameDialog';

const NOTE_EXTENSION = /\.(md|markdown|txt)$/i;

// The start of a new Markdown note of a project's Wissen: the properties every note carries
// (type, status, project, origin …) and its name as the title, from the API
// (GET /knowledge/properties-template). Elsewhere, or if that fails, an empty note.
async function startingContent(scope: FileScope, path: string): Promise<string> {
  const vaultPath = vaultFilePath(scope, path);
  if (scope.kind !== 'project' || !vaultPath || !/\.md$/i.test(path)) return '';
  try {
    return (await getPropertiesTemplate(vaultPath)).content;
  } catch {
    return '';
  }
}

// A new note, opened once it exists. A name without an extension becomes Markdown.
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
  const [preparing, setPreparing] = useState(false);
  const submit = async (name: string) => {
    const path = childPath(folder, NOTE_EXTENSION.test(name) ? name : `${name}.md`);
    setPreparing(true);
    const content = await startingContent(scope, path);
    setPreparing(false);
    create.mutate(
      { path, content },
      {
        onSuccess: (created) => {
          onClose();
          onCreated(created.path);
        },
      },
    );
  };
  return (
    <FileNameDialog
      title={t('newFile')}
      hint={t('fileHint')}
      initialName={t('fileName')}
      submitLabel={t('create')}
      pending={create.isPending || preparing}
      onSubmit={(name) => void submit(name)}
      onClose={onClose}
    />
  );
}
