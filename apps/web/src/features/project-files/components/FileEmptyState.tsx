import { FolderOpen, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

// What an empty folder, or a filter without a match, shows instead of the listing.
export default function FileEmptyState({
  filter,
  canUpload,
  action,
}: {
  filter: string;
  canUpload: boolean;
  action?: ReactNode;
}) {
  const t = useTranslations('files.empty');
  const Icon = filter ? SearchX : FolderOpen;
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">
        {filter ? t('filter', { filter: filter.trim() }) : t('folder')}
      </p>
      {!filter && canUpload && action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
