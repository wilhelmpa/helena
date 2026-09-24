'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { LimitWindow } from '@/lib/api/endpoints/providerLimits';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/dates';
import {
  BAR_CLASS,
  STATE_TEXT_CLASS,
  barPercent,
  formatCountdown,
  windowLabel,
} from '../utils/limitsFormat';

// One window of a plan limit as a 28px line: its name (12px), a bar in the state's colour,
// the share used, and the time until it resets (the date on hover). Only reports; nothing
// here is a control.
export default function LimitWindowRow({ window, now }: { window: LimitWindow; now: number }) {
  const t = useTranslations('providerLimits');
  const format = useFormatter();
  const label = windowLabel(window);
  const percent = barPercent(window);
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : null;
  const name = t(`window.${label.key}`, label.values);
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-2 text-xs">
      <span className="w-24 shrink-0 truncate text-muted-foreground" title={name} dir="auto">
        {name}
      </span>
      <div
        className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', BAR_CLASS[window.state])}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn('w-10 shrink-0 text-end tabular-nums', STATE_TEXT_CLASS[window.state])}>
        {window.currentPercent === null
          ? '–'
          : format.number(Math.round(window.currentPercent) / 100, { style: 'percent' })}
      </span>
      <span
        className="w-24 shrink-0 truncate text-end text-muted-foreground tabular-nums"
        title={window.resetsAt ? formatDateTime(window.resetsAt) : undefined}
      >
        {reset === null
          ? ''
          : reset > now
            ? t('resetsIn', { time: formatCountdown(reset - now) })
            : t('resetDone')}
      </span>
    </div>
  );
}
