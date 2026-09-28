'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { HostHealthItem } from '@/lib/api/endpoints/server';
import { cn } from '@/lib/utils';
import { byKey } from '@/utils/messageKey';
import { useServerSections } from '@/extensions/serverSections';
import { healthStatus, healthValues } from '../utils/serverFormat';

// Small pieces the Server tabs share: a health line, a fact (label and value), a meter.

// One health line: its dot and its message. A report, not a control.
export function HealthLine({ item, className }: { item: HostHealthItem; className?: string }) {
  const message = useHealthMessage();
  return (
    <li className={cn('flex min-h-8 min-w-0 items-center gap-2 px-2 py-1 text-sm', className)}>
      <StatusBadge status={healthStatus(item.state)} dotOnly />
      <span className="min-w-0 flex-1">{message(item)}</span>
    </li>
  );
}

// The text of a health line: Helena's own message for a built-in, the plugin's text otherwise.
export function useHealthMessage() {
  const t = useTranslations('server.health');
  const tRoot = useTranslations();
  const locale = useLocale();
  return (item: HostHealthItem): string => {
    if (item.code && t.has(item.code as never)) return byKey(t)(item.code, healthValues(item));
    if (item.text) return resolveText(item.text, locale, (key) => byKey(tRoot)(key));
    return item.id;
  };
}

export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// A thin progress bar (a rebuild, a check), in the status colour of what it measures.
export function Meter({
  percent,
  tone = 'running',
  label,
}: {
  percent: number;
  tone?: 'running' | 'waiting' | 'success';
  label: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width]',
          tone === 'running' && 'bg-status-running',
          tone === 'waiting' && 'bg-status-waiting',
          tone === 'success' && 'bg-status-success',
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// A card's title row: 14px title, its trailing actions.
export function CardHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      <h3 className="min-w-0 flex-1 text-md font-semibold">{title}</h3>
      {children}
    </div>
  );
}

// The sections other features add to a Server tab (extensions/serverSections.tsx), after the
// tab's own.
export function ServerSections({ area }: { area: string }) {
  const sections = useServerSections(area);
  return (
    <>
      {sections.map((section) => (
        <section
          key={section.id}
          className="min-w-0 rounded-md border border-sidebar-border bg-card p-4"
        >
          <section.Component />
        </section>
      ))}
    </>
  );
}
