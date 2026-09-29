import { Activity, Bot, HeartPulse, ListFilter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type {
  AgentActivityFilters as Filters,
  AgentActivityKind,
} from '@/lib/api/endpoints/agentActivity';
import { PageSelect, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';

const KINDS: AgentActivityKind[] = ['chat', 'agent-run', 'agent-team-run', 'workflow-run'];

// What a filter holds when it is off.
const ANY = 'any';

// The timeline's filters in the header row: the kind of entry and, where the agents of
// one team are known, the agent.
export default function AgentActivityToolbar({
  filters,
  onChange,
  running,
  onRunning,
  allHeartbeats,
  onAllHeartbeats,
  agents,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  // Only entries still at work (?status=running).
  running: boolean;
  onRunning: (running: boolean) => void;
  // Heartbeats without a result one by one instead of bundled.
  allHeartbeats: boolean;
  onAllHeartbeats: (all: boolean) => void;
  agents: AiAgent[];
}) {
  const t = useTranslations('agentActivity');

  return (
    <PageToolbar>
      <PageToolbarSpacer />
      <PageSelect<string>
        label={t('filterStatus')}
        icon={Activity}
        value={running ? 'running' : ANY}
        defaultValue={ANY}
        onChange={(value) => onRunning(value === 'running')}
        options={[
          { value: ANY, label: t('allStatuses') },
          { value: 'running', label: t('statusRunning') },
        ]}
      />
      <PageSelect<string>
        label={t('filterKind')}
        icon={ListFilter}
        value={filters.kind ?? ANY}
        defaultValue={ANY}
        onChange={(value) =>
          onChange({ ...filters, kind: value === ANY ? undefined : (value as AgentActivityKind) })
        }
        options={[
          { value: ANY, label: t('allKinds') },
          ...KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) })),
        ]}
      />
      <PageSelect<string>
        label={t('filterHeartbeats')}
        icon={HeartPulse}
        value={allHeartbeats ? 'all' : 'bundled'}
        defaultValue="bundled"
        onChange={(value) => onAllHeartbeats(value === 'all')}
        options={[
          { value: 'bundled', label: t('heartbeatsBundled') },
          { value: 'all', label: t('heartbeatsAll') },
        ]}
      />
      {agents.length > 0 && (
        <PageSelect
          label={t('filterAgent')}
          icon={Bot}
          value={filters.agentId ? String(filters.agentId) : ANY}
          defaultValue={ANY}
          onChange={(value) =>
            onChange({ ...filters, agentId: value === ANY ? undefined : Number(value) })
          }
          options={[
            { value: ANY, label: t('allAgents') },
            ...agents.map((agent) => ({ value: String(agent.id), label: agent.name })),
          ]}
        />
      )}
    </PageToolbar>
  );
}
