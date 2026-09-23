'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { compactTokens } from '@/utils/agentUsage';

// What a run read and wrote. Nothing where the agent reported no counts.
export function AgentTokenCounts({
  input,
  output,
}: {
  input: number | null;
  output: number | null;
}) {
  const t = useTranslations('common.agentChat');
  if (input == null && output == null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
          {compactTokens(input ?? 0)} / {compactTokens(output ?? 0)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t('tokenCounts', { input: input ?? 0, output: output ?? 0 })}
      </TooltipContent>
    </Tooltip>
  );
}
