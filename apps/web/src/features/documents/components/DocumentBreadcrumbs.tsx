import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { baseName, foldersBetween, noteName } from '../utils/vaultPaths';

export default function DocumentBreadcrumbs({ root, path }: { root: string; path: string }) {
  const t = useTranslations('documents');
  const folders = foldersBetween(root, path);

  return (
    <nav
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px] text-muted-foreground"
      aria-label={t('breadcrumb')}
    >
      <span className="shrink-0 px-1 py-0.5 font-medium">{t('title')}</span>
      {folders.map((folder, index) => (
        <span
          key={folder}
          className={cn(
            'hidden min-w-0 items-center gap-1',
            index === folders.length - 1 ? 'sm:flex' : 'xl:flex',
          )}
        >
          <ChevronRight className="size-3 shrink-0 rtl:rotate-180" />
          <span className="max-w-32 truncate px-1 py-0.5" dir="auto" title={baseName(folder)}>
            {baseName(folder)}
          </span>
        </span>
      ))}
      <ChevronRight className="size-3 shrink-0 rtl:rotate-180" />
      <span
        className="min-w-8 truncate px-1 py-0.5 font-medium text-foreground"
        dir="auto"
        aria-current="page"
      >
        {noteName(path)}
      </span>
    </nav>
  );
}
