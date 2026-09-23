import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';

// The open folder as a path of links back up. Each link takes entries dropped on it.
export default function FileBreadcrumbs({
  rootLabel,
  path,
  drag,
  onNavigate,
}: {
  rootLabel: string;
  path: string;
  drag: FileEntryDrag;
  onNavigate: (path: string) => void;
}) {
  const t = useTranslations('files');
  const parts = path.split('/').filter(Boolean);
  const crumbs = [
    { label: rootLabel, target: '' },
    ...parts.map((part, index) => ({ label: part, target: parts.slice(0, index + 1).join('/') })),
  ];

  return (
    <nav
      aria-label={t('breadcrumb')}
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm"
    >
      {crumbs.map((crumb, index) => (
        <span key={crumb.target} className="flex shrink-0 items-center gap-1">
          {index > 0 && <ChevronRight className="size-3.5 text-muted-foreground rtl:rotate-180" />}
          <button
            type="button"
            {...drag.target(crumb.target)}
            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
            className={cn(
              'rounded px-1.5 py-1 hover:bg-accent',
              index === crumbs.length - 1 && 'font-medium',
              drag.over === crumb.target && 'bg-primary/10',
            )}
            dir="auto"
            onClick={() => onNavigate(crumb.target)}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
