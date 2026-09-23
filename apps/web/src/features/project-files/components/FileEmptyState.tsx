import { FolderOpen, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';

// What an empty folder, or a filter without a match, shows instead of the listing.
export default function FileEmptyState({
  filter,
  canUpload,
}: {
  filter: string;
  canUpload: boolean;
}) {
  const t = useTranslations('files.empty');
  const Icon = filter ? SearchX : FolderOpen;
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">
        {filter ? t('filter', { filter: filter.trim() }) : t('folder')}
      </p>
      {!filter && (
        <p className="mt-1 text-sm text-muted-foreground">
          {canUpload ? t('folderHint') : t('readOnly')}
        </p>
      )}
    </div>
  );
}
