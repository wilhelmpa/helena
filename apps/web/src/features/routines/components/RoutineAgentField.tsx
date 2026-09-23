import { Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RoutineField } from './RoutineField';

// The agent a routine delegates its task to. Only an agent that runs when it is
// delegated to can take one — and only a real agent: a pool template runs nowhere, so
// it is filtered out here the same way chat's agent pickers filter it out, even
// though a routine's own agent list is normally project-scoped already (a template
// joins no project) and so would not carry one in practice.
export function RoutineAgentField({
  agents,
  agentId,
  onChange,
}: {
  agents: AiAgent[];
  agentId: string;
  onChange: (agentId: string) => void;
}) {
  const t = useTranslations('routines');
  const tAgents = useTranslations('teams.agents');
  const selectable = agents.filter((item) => !item.template);
  const agent = selectable.find((item) => String(item.id) === agentId) ?? null;
  return (
    <RoutineField htmlFor="routine-agent" label={t('agent')}>
      <Select value={agentId} onValueChange={onChange}>
        <SelectTrigger id="routine-agent" className="w-full" aria-required="true">
          <SelectValue placeholder={t('selectAgent')} />
        </SelectTrigger>
        <SelectContent>
          {selectable.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
              <span className="text-xs text-muted-foreground">
                {tAgents(`kindLabel.${item.kind}`)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {agent && !agent.triggerOnAssign && (
        <p className="text-xs text-destructive">{t('agentNotDelegated')}</p>
      )}
      {agent?.triggerOnAssign && agent.kind === 'external' && (
        <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
          <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground">{t('externalAgentHint')}</p>
            <AgentRunnerStatus agent={agent} />
          </div>
        </div>
      )}
    </RoutineField>
  );
}
