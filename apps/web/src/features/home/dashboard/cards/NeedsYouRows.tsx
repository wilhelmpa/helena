'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CircleCheck,
  CircleCheckBig,
  History,
  Lightbulb,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS, RowEmpty } from '@/components/common/page/RowList';
import { globalAgentActivityPath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import { cn } from '@/lib/utils';
import { SkeletonRows } from '../DashboardCard';
import type { NeedsYouKind } from '../needsYou';
import type { NeedsYouData, NeedsYouEntry } from '../useNeedsYou';

const ICON: Record<NeedsYouKind, LucideIcon> = {
  approval: CircleCheck,
  step: Workflow,
  proposals: Lightbulb,
  failure: AlertTriangle,
};

// One entry: the whole row opens it; a failure has a "hide" button at its end (always
// shown on a touch screen, on hover or focus otherwise).
export function NeedsYouRow({
  entry,
  onDismiss,
  twoLine = false,
}: {
  entry: NeedsYouEntry;
  onDismiss?: (key: string) => void;
  twoLine?: boolean;
}) {
  const t = useTranslations('home');
  const Icon = ICON[entry.kind];
  const failure = entry.kind === 'failure';
  const time = entry.at ? formatDurationShort(entry.at) : '';
  return (
    <div className="group/row relative min-w-0">
      <Link
        href={entry.href}
        className={cn(
          ROW_CLASS,
          ROW_INTERACTIVE_CLASS,
          failure && onDismiss && 'pointer-coarse:pe-9',
          twoLine && 'h-auto min-h-8 items-start py-1.5 [&>svg]:mt-0.5',
        )}
      >
        <Icon className={failure ? 'text-status-danger!' : 'text-status-waiting!'} />
        {twoLine ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate" dir="auto">
              {entry.title}
            </span>
            <span className="truncate text-xs text-muted-foreground" dir="auto">
              {[failure ? t('needsYou.failed') : null, entry.detail].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : (
          <>
            <span className="min-w-0 shrink truncate" dir="auto">
              {entry.title}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
              {entry.detail}
            </span>
          </>
        )}
        {time && (
          <span
            className={cn(
              'shrink-0 text-xs text-muted-foreground tabular-nums',
              failure &&
                onDismiss &&
                'pointer-fine:group-focus-within/row:invisible pointer-fine:group-hover/row:invisible',
            )}
          >
            {time}
          </span>
        )}
      </Link>
      {failure && onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(entry.key)}
          aria-label={t('needsYou.hide')}
          title={t('needsYou.hide')}
          className="absolute end-1 top-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none pointer-coarse:opacity-100 [&>svg]:size-3.5"
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}

// The card's body: the entries up to `limit`, then one line for what is not a row of its
// own (older failures, the ones hidden), with the way to the activity page.
export default function NeedsYouRows({
  data,
  limit,
  onDismiss,
  twoLine = false,
}: {
  data: NeedsYouData;
  limit: number;
  onDismiss?: (key: string) => void;
  twoLine?: boolean;
}) {
  const t = useTranslations('home');
  if (data.isPending) return <SkeletonRows count={Math.min(3, limit)} />;
  const shown = data.items.slice(0, limit);
  const more = data.items.length - shown.length;
  return (
    <>
      {shown.length === 0 ? (
        <RowEmpty icon={<CircleCheckBig className="text-status-success!" />}>
          {t('needsYou.empty')}
        </RowEmpty>
      ) : (
        shown.map((entry) => (
          <NeedsYouRow key={entry.key} entry={entry} onDismiss={onDismiss} twoLine={twoLine} />
        ))
      )}
      {(more > 0 || data.aged > 0 || data.hidden > 0) && (
        <Link
          href={globalAgentActivityPath()}
          className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, 'text-xs text-muted-foreground')}
        >
          <History />
          <span className="min-w-0 flex-1 truncate">
            {[
              more > 0 ? t('needsYou.more', { count: more }) : null,
              data.aged > 0 ? t('needsYou.aged', { count: data.aged }) : null,
              data.hidden > 0 ? t('needsYou.hidden', { count: data.hidden }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Link>
      )}
    </>
  );
}
