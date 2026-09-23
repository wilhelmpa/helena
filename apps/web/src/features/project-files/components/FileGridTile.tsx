import FileKindIcon from '@/components/common/files/FileKindIcon';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { fileViewKind } from '@/utils/fileKinds';
import { formatSize } from '@/utils/fileSize';
import { cn } from '@/lib/utils';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import type { FilePermissions } from './FileBrowser';
import FileItemMenu from './FileItemMenu';

// One entry of the grid view: an image shows itself, everything else its kind.
export default function FileGridTile({
  item,
  previewUrl,
  actions,
  can,
  drag,
  highlighted,
}: {
  item: FileItem;
  previewUrl: string;
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  highlighted: boolean;
}) {
  const image = item.kind === 'file' && fileViewKind(item.name, item.contentType) === 'image';
  return (
    <div
      {...drag.source(item)}
      {...(item.kind === 'folder' ? drag.target(item.path) : {})}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-card',
        drag.over === item.path && 'border-primary bg-primary/10',
        highlighted && 'ring-2 ring-ring',
      )}
    >
      <button
        type="button"
        className="flex aspect-[4/3] items-center justify-center bg-muted/50"
        onClick={() => actions.open(item)}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <FileKindIcon
            name={item.name}
            contentType={item.contentType}
            folder={item.kind === 'folder'}
            className="size-10"
          />
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" dir="auto" title={item.name}>
            {item.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.sizeBytes !== null ? formatSize(item.sizeBytes) : ' '}
          </p>
        </div>
        <FileItemMenu item={item} actions={actions} can={can} />
      </div>
    </div>
  );
}
