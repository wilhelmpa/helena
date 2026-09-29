import { useTranslations } from 'next-intl';
import { Copy, History, MessageSquare, Trash2 } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { isRunnerOnline } from '@/components/common/agent-chat/runnerOnline';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { useAgentStatus } from '@/utils/helenaStatus';
import { ActionMenu, List, ListGroup, ListRow, Orb, Pill } from '@/design-system';
import { useAgentCan } from '../../context/agentSection';
import { poolRowText } from '../../utils/agentPool';

// The team's agents as one calm list (owner, H: "sehr dichte Tabelle", the key column
// was noise): the agent's status, its name, where it works, and its row's "…". A click on
// the row opens the agent; the key and the rest of its configuration live there.
export default function TeamAiAgentTable({
  label,
  agents,
  copyCounts,
  onEdit,
  onRuns,
  onDelete,
}: {
  label: string;
  agents: AiAgent[];
  // How many project copies each template has (template rows only).
  copyCounts?: Map<number, number>;
  onEdit: (agent: AiAgent) => void;
  onRuns: (agent: AiAgent) => void;
  onDelete: (agent: AiAgent) => void;
}) {
  const work = useAgentWorkStates();
  return (
    <List label={label}>
      <ListGroup label={label} count={agents.length}>
      {agents.map((agent) => (
        <PoolRow
          key={agent.id}
          agent={agent}
          work={work.get(agent.id)}
          copies={copyCounts?.get(agent.id)}
          onEdit={() => onEdit(agent)}
          onRuns={() => onRuns(agent)}
          onDelete={() => onDelete(agent)}
        />
      ))}
      </ListGroup>
    </List>
  );
}

function PoolRow({
  agent,
  work,
  copies,
  onEdit,
  onRuns,
  onDelete,
}: {
  agent: AiAgent;
  work?: 'running' | 'waiting';
  copies?: number;
  onEdit: () => void;
  onRuns: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('teams.agents');
  const can = useAgentCan();
  const status = useAgentStatus(agent.id, {
    run: work,
    runtimeStatus: isRunnerOnline(agent) ? agent.runtimeState.status : 'offline',
  });
  const text = poolRowText(agent);
  return (
    <ListRow
      icon={agent.template ? <Copy /> : <Orb state={status} size="small" />}
      title={agent.name}
      subtitle={
        text.projects.length > 0 ? text.projects.join(' · ') : agent.template ? undefined : t('noProjectsShort')
      }
      meta={
        agent.template ? (
          t('copies', { count: copies ?? 0 })
        ) : agent.pausedAt ? (
          <Pill tone="warning">{t('paused')}</Pill>
        ) : (
          (text.model ?? t('defaultModel'))
        )
      }
      onSelect={can('edit') ? onEdit : undefined}
      actions={
        <ActionMenu
          label={t('moreActionsFor', { name: agent.name })}
          items={[
            ...(can('read')
              ? [
                  {
                    id: 'runs',
                    label: t('runHistory'),
                    icon: <History size={14} />,
                    onSelect: onRuns,
                  },
                  {
                    id: 'chat',
                    label: t('testChat'),
                    icon: <MessageSquare size={14} />,
                    onSelect: onEdit,
                  },
                ]
              : []),
            ...(can('delete')
              ? [
                  {
                    id: 'delete',
                    label: t('delete'),
                    icon: <Trash2 size={14} />,
                    onSelect: onDelete,
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      }
    />
  );
}
