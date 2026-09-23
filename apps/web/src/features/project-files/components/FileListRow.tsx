import { useTranslations } from 'next-intl';
import FileKindIcon from '@/components/common/files/FileKindIcon';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { formatSize } from '@/utils/fileSize';
import { cn } from '@/lib/utils';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import type { FilePermissions } from './FileBrowser';
import FileItemMenu from './FileItemMenu';

// One entry of the list view. A folder takes entries dropped on it.
export default function FileListRow({
  item,
  actions,
  can,
  drag,
  highlighted,
}: {
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  highlighted: boolean;
}) {
  const format = useTranslations('files');
  return (
    <li
      {...drag.source(item)}
      {...(item.kind === 'folder' ? drag.target(item.path) : {})}
      className={cn(
        'group flex items-center gap-3 px-3 py-2',
        drag.over === item.path && 'bg-primary/10',
        highlighted && 'bg-accent',
      )}
    >
      <FileKindIcon
        name={item.name}
        contentType={item.contentType}
        folder={item.kind === 'folder'}
        className="size-4 shrink-0"
      />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-start text-sm font-medium hover:underline"
        dir="auto"
        onClick={() => actions.open(item)}
      >
        {item.name}
      </button>
      <span className="hidden w-36 shrink-0 text-xs text-muted-foreground sm:block">
        {item.updatedAt ? format('modified', { date: new Date(item.updatedAt) }) : ''}
      </span>
      <span className="w-20 shrink-0 text-end text-xs text-muted-foreground">
        {item.sizeBytes !== null ? formatSize(item.sizeBytes) : ''}
      </span>
      <FileItemMenu item={item} actions={actions} can={can} />
    </li>
  );
}
