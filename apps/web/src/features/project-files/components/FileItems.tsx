import { fileRawUrl, type FileItem, type FileScope } from '@/lib/api/endpoints/projectFiles';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import type { FileViewMode } from '../hooks/useFileBrowserView';
import type { FilePermissions } from './FileBrowser';
import FileGridTile from './FileGridTile';
import FileListRow from './FileListRow';

// The entries of the open folder as a list or a grid.
export default function FileItems({
  items,
  mode,
  scope,
  actions,
  can,
  drag,
  highlighted,
}: {
  items: FileItem[];
  mode: FileViewMode;
  scope: FileScope;
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  highlighted: string | null;
}) {
  if (mode === 'grid') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {items.map((item) => (
          <FileGridTile
            key={item.path}
            item={item}
            previewUrl={fileRawUrl(scope, item.path)}
            actions={actions}
            can={can}
            drag={drag}
            highlighted={highlighted === item.path}
          />
        ))}
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {items.map((item) => (
        <FileListRow
          key={item.path}
          item={item}
          actions={actions}
          can={can}
          drag={drag}
          highlighted={highlighted === item.path}
        />
      ))}
    </ul>
  );
}
