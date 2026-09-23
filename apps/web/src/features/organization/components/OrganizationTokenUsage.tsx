'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { usagePercent } from '../utils/tokenCeilings';

// The tokens used in one period against its ceiling, with a bar once a ceiling is set.
export default function OrganizationTokenUsage({
  label,
  used,
  ceiling,
}: {
  label: string;
  used: number;
  ceiling: number | null;
}) {
  const t = useTranslations('organization.tokens');
  const percent = usagePercent(used, ceiling);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {ceiling == null
            ? `${t('used', { used })} · ${t('noCeiling')}`
            : t('usedOfCeiling', { used, ceiling })}
        </span>
      </div>
      {percent != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full',
              percent >= 100 ? 'bg-status-danger' : percent >= 80 ? 'bg-status-waiting' : 'bg-primary',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
