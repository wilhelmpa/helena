import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { childPath } from '@/utils/vaultLinks';
import { useCreateTextFile } from '../services/projectFiles.service';
import FileNameDialog from './FileNameDialog';

export default function FileNewCanvasDialog({
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
  const create = useCreateTextFile(scope);
  return (
    <FileNameDialog
      title="Neue Leinwand"
      hint="Name der Leinwand"
      initialName="Neue Leinwand"
      submitLabel="Erstellen"
      pending={create.isPending}
      onSubmit={(name) =>
        create.mutate(
          {
            path: childPath(folder, /\.canvas$/i.test(name) ? name : `${name}.canvas`),
            content: JSON.stringify({ nodes: [], edges: [] }, null, 2),
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
