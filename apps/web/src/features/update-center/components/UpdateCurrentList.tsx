import { CircleCheck, CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RowList, SectionLabel } from '@/components/common/page/RowList';
import type { UpdateItem } from '@/lib/api/endpoints/updateCenter';
import { cn } from '@/lib/utils';
import { versionStep } from '../utils/updateFormat';
import { useSourceText } from './UpdateCard';

export default function UpdateCurrentList({
  current,
  title = 'current',
}: {
  current: UpdateItem[];
  title?: 'current' | 'unverified';
}) {
  const t = useTranslations('updates');
  const text = useSourceText();
  if (current.length === 0) return null;
  return (
    <section className="min-w-0">
      <SectionLabel>{t(title)}</SectionLabel>
      <RowList className="bg-card">
        {current.map((item) => (
          <div
            key={item.id}
            className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm"
          >
            {item.error || !item.installed || !item.available ? (
              <CircleHelp
                className={cn(
                  'size-4 shrink-0',
                  item.error ? 'text-status-waiting' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
            ) : (
              <CircleCheck className="size-4 shrink-0 text-status-success" aria-hidden="true" />
            )}
            <span className="min-w-0 shrink truncate" dir="auto">
              {item.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {versionStep(item)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
              {item.error ?? text(item.hint) ?? ''}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {text(item.sourceLabel)}
            </span>
          </div>
        ))}
      </RowList>
    </section>
  );
}
