'use client';

import { Pill } from '@/design-system';
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
        <Pill
          tone={level === 3 ? 'warning' : 'neutral'}
          icon={<Gauge className="size-3" />}
          aria-label={t('badgeTitle', { level, name })}
          className={cn('shrink-0 tabular-nums', className)}
        >
          {t('badge', { level })}
        </Pill>
      </TooltipTrigger>
      <TooltipContent>{t('badgeTitle', { level, name })}</TooltipContent>
    </Tooltip>
  );
}
