import { FolderOpen, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { EmptyState } from '@/design-system';

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
    <EmptyState
      boxed
      fill={false}
      icon={<Icon />}
      title={filter ? t('filter', { filter: filter.trim() }) : t('folder')}
      action={!filter && canUpload ? action : undefined}
    />
  );
}
