import { useTranslations } from 'next-intl';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { childPath } from '@/utils/vaultLinks';
import { useCreateTextFile } from '../services/projectFiles.service';
import { vaultFilePath } from '../utils/vaultFilePath';
import FileNameDialog from './FileNameDialog';

// The first views of a new .base: the notes of the folder it is made in, as a table,
// cards and a list, with the properties new notes carry (type, status). Obsidian opens the
// same file (docs/helena-decisions/second-brain-obsidian.md).
export function newBaseContent(folder: string | null, names: [string, string, string]) {
  const quote = (value: string) => JSON.stringify(value);
  const inside = folder?.replace(/\/+$/, '');
  const scopeFilter = inside ? [`    - 'file.inFolder(${quote(inside)})'`] : [];
  return [
    'filters:',
    '  and:',
    ...scopeFilter,
    `    - 'file.ext == "md"'`,
    'views:',
    '  - type: table',
    `    name: ${quote(names[0])}`,
    '    order:',
    '      - file.name',
    '      - note.type',
    '      - note.status',
    '  - type: cards',
    `    name: ${quote(names[1])}`,
    '    order:',
    '      - file.name',
    '      - note.status',
    '  - type: list',
    `    name: ${quote(names[2])}`,
    '    order:',
    '      - file.name',
    '      - note.status',
    '',
  ].join('\n');
}

export default function FileNewBaseDialog({
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
  const t = useTranslations('files.base');
  const create = useCreateTextFile(scope);
  return (
    <FileNameDialog
      title={t('newTitle')}
      hint={t('newHint')}
      initialName={t('newName')}
      submitLabel={t('create')}
      pending={create.isPending}
      onSubmit={(name) =>
        create.mutate(
          {
            path: childPath(folder, /\.base$/i.test(name) ? name : `${name}.base`),
            content: newBaseContent(vaultFilePath(scope, folder), [
              t('viewTable'),
              t('viewCards'),
              t('viewList'),
            ]),
          },
          {
            onSuccess: (result) => {
              onClose();
              onCreated(result.path);
            },
          },
        )
      }
      onClose={onClose}
    />
  );
}
