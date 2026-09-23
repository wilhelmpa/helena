import { Check, Circle, LoaderCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AgentTeamRun } from '@/lib/api/endpoints/issues';
import { cn } from '@/lib/utils';
import { AGENT_TEAM_STEPS, agentTeamStepStatus } from '../../utils/agentTeam';

const icon = {
  success: Check,
  running: LoaderCircle,
  failed: X,
} as const;

// The four stages of an agent-team run in order, each with its Mastra step status.
export default function IssueAgentTeamSteps({ run }: { run: AgentTeamRun }) {
  const t = useTranslations('issue.agentTeam.steps');
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {AGENT_TEAM_STEPS.map((step, index) => {
        const status = agentTeamStepStatus(run, step);
        const Icon = icon[status as keyof typeof icon] ?? Circle;
        return (
          <li key={step} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground/50">›</span>}
            <span
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5',
                status === 'success' &&
                  'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                status === 'running' && 'border-sky-500/40 text-sky-700 dark:text-sky-400',
                status === 'failed' && 'border-destructive/40 text-destructive',
                !(status in icon) && 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-3', status === 'running' && 'animate-spin')} />
              {t(step === 'synchronize-plan' ? 'synchronize' : step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
