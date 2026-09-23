import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type {
  AgentActivityFilters as Filters,
  AgentActivityKind,
} from '@/lib/api/endpoints/agentActivity';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';

const KINDS: AgentActivityKind[] = ['chat', 'agent-run', 'agent-team-run', 'workflow-run'];

// What a select shows when its filter is off: Radix gives an empty value no item.
const ANY = 'any';

export default function AgentActivityFilters({
  filters,
  onChange,
  agents,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  agents: AiAgent[];
}) {
  const t = useTranslations('agentActivity');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DisplaySettingsSelect
        value={filters.kind ?? ANY}
        onChange={(value) =>
          onChange({ ...filters, kind: value === ANY ? undefined : (value as AgentActivityKind) })
        }
        options={[
          { value: ANY, label: t('allKinds') },
          ...KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) })),
        ]}
      />
      {agents.length > 0 && (
        <DisplaySettingsSelect
          value={filters.agentId ? String(filters.agentId) : ANY}
          onChange={(value) =>
            onChange({ ...filters, agentId: value === ANY ? undefined : Number(value) })
          }
          options={[
            { value: ANY, label: t('allAgents') },
            ...agents.map((agent) => ({ value: String(agent.id), label: agent.name })),
          ]}
        />
      )}
    </div>
  );
}
