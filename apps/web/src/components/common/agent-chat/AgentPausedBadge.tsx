'use client';

import { CirclePause } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Marks an agent that takes no new work, with why on hover. Renders nothing for an agent
// that is not paused.
export function AgentPausedBadge({
  agent,
}: {
  agent: { pausedAt: string | null; pauseReason: string | null };
}) {
  const t = useTranslations('teams.agents');
  if (!agent.pausedAt) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="shrink-0 gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
        >
          <CirclePause className="size-3" />
          {t('paused')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" dir="auto">
        {agent.pauseReason ?? t('pausedNoReason')}
      </TooltipContent>
    </Tooltip>
  );
}
