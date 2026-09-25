'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CircleCheck,
  CircleCheckBig,
  History,
  Lightbulb,
  OctagonAlert,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS, RowEmpty } from '@/components/common/page/RowList';
import { approvalsPath, globalAgentActivityPath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import { cn } from '@/lib/utils';
import type { NeedsYouEntry } from '@/extensions/needsYouSources';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import type { NeedsYouKind } from '../needsYou';
import { useHomeDashboardContext } from '../useHomeDashboard';
import { useNeedsYou } from '../useNeedsYou';

const SHOWN = 6;

const ICON: Record<NeedsYouKind, LucideIcon> = {
  problem: OctagonAlert,
  approval: CircleCheck,
  step: Workflow,
  proposals: Lightbulb,
  failure: AlertTriangle,
};

// Red for what is broken (a problem, a failure), amber for what waits on a decision.
const red = (kind: NeedsYouKind) => kind === 'problem' || kind === 'failure';

// The row itself: a link to a page, or a button that opens a dialog (the health overview).
function RowTarget({
  entry,
  className,
  children,
}: {
  entry: NeedsYouEntry;
  className: string;
  children: ReactNode;
}) {
  if (entry.href)
    return (
      <Link href={entry.href} className={className}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={entry.onSelect} className={cn(className, 'w-full text-start')}>
      {children}
    </button>
  );
}

// One entry: the whole row opens it; a failure has a "hide" button at its end (always
// shown on a touch screen, on hover or focus otherwise, where it takes the time's place).
function NeedsYouRow({ entry, onDismiss }: { entry: NeedsYouEntry; onDismiss?: () => void }) {
  const t = useTranslations('home.needsYou');
  const Icon = entry.icon ?? ICON[entry.kind];
  const dismissible = entry.kind === 'failure' && !!onDismiss;
  const time = entry.at ? formatDurationShort(entry.at) : '';
  return (
    <div className="group/row relative min-w-0">
      <RowTarget
        entry={entry}
        className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, dismissible && 'pointer-coarse:pe-9')}
      >
        <Icon className={red(entry.kind) ? 'text-status-danger!' : 'text-status-waiting!'} />
        <span
          className={cn('min-w-0 shrink truncate', entry.kind === 'problem' && 'font-medium')}
          dir="auto"
        >
          {entry.title}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
          {entry.detail}
        </span>
        {time && (
          <span
            className={cn(
              'shrink-0 text-xs text-muted-foreground tabular-nums',
              dismissible &&
                'pointer-fine:group-focus-within/row:invisible pointer-fine:group-hover/row:invisible',
            )}
          >
            {time}
          </span>
        )}
      </RowTarget>
      {dismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('hide')}
          title={t('hide')}
          className="absolute end-1 top-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none pointer-coarse:opacity-100 [&>svg]:size-3.5"
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}

// "Braucht dich": red problems of the system, then what waits on a decision, then fresh
// failures; the rest (more than fit, failures older than a day, the hidden ones) in one
// line with the way to the activity page.
export default function NeedsYouSection() {
  const t = useTranslations('home');
  const tNav = useTranslations('nav');
  const { owner, dismissed, dismiss } = useHomeDashboardContext();
  const data = useNeedsYou(dismissed, owner);
  const shown = data.items.slice(0, SHOWN);
  const more = data.items.length - shown.length;
  return (
    <DashboardSection
      label={t('widgets.needs-you')}
      count={data.items.length}
      href={approvalsPath()}
      hrefLabel={tNav('approvals')}
    >
      {data.isPending && shown.length === 0 ? (
        <SkeletonRows count={3} />
      ) : shown.length === 0 ? (
        <RowEmpty icon={<CircleCheckBig className="text-status-success!" />}>
          {t('needsYou.empty')}
        </RowEmpty>
      ) : (
        shown.map((entry) => (
          <NeedsYouRow
            key={entry.key}
            entry={entry}
            onDismiss={() => dismiss(entry.key, data.failureKeys)}
          />
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
    </DashboardSection>
  );
}
