import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { FileItem, FileList, FileScope } from '@/lib/api/endpoints/projectFiles';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import type { FileViewMode } from '../hooks/useFileBrowserView';
import type { FilePermissions } from './FileBrowser';
import FileEmptyState from './FileEmptyState';
import FileItems from './FileItems';
import FileLoadError from './FileLoadError';

// The open folder in whatever state its listing is: loading, refused, empty, or its
// entries.
export default function FileFolderContent({
  listing,
  items,
  filter,
  mode,
  scope,
  actions,
  can,
  drag,
  selected,
  codeUrl,
}: {
  listing: UseQueryResult<FileList>;
  items: FileItem[];
  filter: string;
  mode: FileViewMode;
  scope: FileScope;
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  selected: string | null;
  codeUrl: string;
}) {
  const t = useTranslations('files');
  if (listing.isPending)
    return <p className="text-sm text-muted-foreground">{t('viewer.loading')}</p>;
  if (listing.isError) {
    return (
      <FileLoadError error={listing.error} codeUrl={codeUrl} onRetry={() => listing.refetch()} />
    );
  }
  return (
    <>
      {items.length === 0 ? (
        <FileEmptyState filter={filter} canUpload={can.create} />
      ) : (
        <FileItems
          items={items}
          mode={mode}
          scope={scope}
          actions={actions}
          can={can}
          drag={drag}
          highlighted={selected}
        />
      )}
      {listing.data.truncated && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('truncated', { count: listing.data.items.length })}
        </p>
      )}
    </>
  );
}
