'use client';

import { useTranslations } from 'next-intl';
import { Gauge } from 'lucide-react';
import type { AutopilotLevel } from '@/lib/api/endpoints/autopilot';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// The small mark of the Autopilot level a run worked at, or a task's latest run did:
// "A2", with the level's name on hover.
export default function AutopilotLevelBadge({
  level,
  className,
}: {
  level: number | null | undefined;
  className?: string;
}) {
  const t = useTranslations('autopilot');
  if (level == null || level < 0 || level > 3) return null;
  const name = t(`level.${level as AutopilotLevel}.name`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={t('badgeTitle', { level, name })}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-sm border border-sidebar-border bg-card px-1 text-xs font-medium text-muted-foreground tabular-nums',
            level === 3 && 'text-status-waiting',
            className,
          )}
        >
          <Gauge className="size-3" />
          {t('badge', { level })}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t('badgeTitle', { level, name })}</TooltipContent>
    </Tooltip>
  );
}
