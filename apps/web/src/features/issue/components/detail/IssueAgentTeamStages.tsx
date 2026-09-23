import { useTranslations } from 'next-intl';
import { AgentTokenCounts } from '@/components/common/agent-chat/AgentTokenCounts';
import type { AgentTeamStage } from '@/lib/api/endpoints/issues';
import { formatElapsed } from '@/utils/agentUsage';
import { isKnownStatus } from '../../utils/agentTeam';

// The Hermes run behind each stage: the agent that ran it, how it ended, how long it
// took and what it read and wrote.
export default function IssueAgentTeamStages({ stages }: { stages: AgentTeamStage[] }) {
  const t = useTranslations('issue.agentTeam');
  if (stages.length === 0) return null;

  return (
    <ul className="space-y-1 text-xs">
      {stages.map((stage) => (
        <li
          key={stage.agentRunId}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground"
        >
          <span className="font-medium text-foreground">{t(`phases.${stage.phase}`)}</span>
          {stage.assignmentId && <span dir="auto">{stage.assignmentId}</span>}
          <span>@{stage.agent.username}</span>
          <span>{isKnownStatus(stage.status) ? t(`status.${stage.status}`) : stage.status}</span>
          {stage.durationMs != null && <span dir="ltr">{formatElapsed(stage.durationMs)}</span>}
          <AgentTokenCounts input={stage.inputTokens} output={stage.outputTokens} />
        </li>
      ))}
    </ul>
  );
}
