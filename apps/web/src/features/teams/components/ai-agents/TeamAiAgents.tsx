import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import {
  useAiAgentsQuery,
  useDeleteAiAgent,
  useSaveAiAgentAsTemplate,
} from '@/services/aiAgents.service';
import { openAgent } from '@/features/settings/settingsModalCatalog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useAgentSection } from '../../context/agentSection';
import TeamAiAgentTable from './TeamAiAgentTable';
import { useTranslations } from 'next-intl';
import { Bot } from 'lucide-react';
import { EmptyState, Stack, Text } from '@/design-system';
import { filterPool, type PoolShow } from '../../utils/agentPool';

// The agents of a team: bot users that issues can be delegated to in any project the
// team attaches them to, and below them the templates projects copy their specialists
// from — the Liste view of Team (Auftrag 117). A click opens the agent in the one overlay
// on the right (the agent dialog), never a page of its own.
export default function TeamAiAgents({
  search = '',
  show = 'all',
  projectKey = null,
}: {
  search?: string;
  show?: PoolShow;
  // On a project's Team page: its agents (and the templates it can add copies of).
  projectKey?: string | null;
}) {
  const t = useTranslations('teams.agents');
  const tPool = useTranslations('organization.pool');
  const { teamId } = useAgentSection();
  const agentsQuery = useAiAgentsQuery(teamId);
  const agents = agentsQuery.data ?? [];
  const deleteAgent = useDeleteAiAgent(teamId);
  const saveTemplate = useSaveAiAgentAsTemplate(teamId);
  const [deleting, setDeleting] = useState<AiAgent | null>(null);

  // A `/skills` or `/memory` chat command, or an old link, names one agent (`?agent=<id>`,
  // `&tab=`): it opens in the agent dialog, and the params leave the address.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const requested = searchParams.get('agent');
    if (!requested || agentsQuery.isPending) return;
    const id =
      requested === 'home'
        ? agents.find((agent) => agent.agentRole === 'home')?.id
        : Number(requested);
    if (id != null && agents.some((a) => a.id === id))
      openAgent(id, teamId, searchParams.get('tab') ?? undefined);
    const params = new URLSearchParams(searchParams);
    params.delete('agent');
    params.delete('section');
    params.delete('tab');
    params.delete('run');
    router.replace(params.size > 0 ? `?${params.toString()}` : window.location.pathname);
    // Only the deep link itself should ever trigger this; agents/router are stable
    // enough here not to re-run it on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, agentsQuery.isPending]);

  const groups = filterPool(agents, { search, show, projectKey });
  // How many project copies each template has: "0 Kopien" on its row says it is unused.
  const copyCounts = new Map<number, number>();
  for (const agent of agents) {
    if (agent.sourceTemplateId == null) continue;
    copyCounts.set(agent.sourceTemplateId, (copyCounts.get(agent.sourceTemplateId) ?? 0) + 1);
  }
  const tableProps = {
    onEdit: (agent: AiAgent) => openAgent(agent.id, teamId, 'overview'),
    // The runs are a tab of the agent's dialog.
    onRuns: (agent: AiAgent) => openAgent(agent.id, teamId, 'runs'),
    onDelete: setDeleting,
    onSaveTemplate: (agent: AiAgent) => saveTemplate.mutate({ agentId: agent.id }),
  };
  const nothing = groups.agents.length === 0 && groups.templates.length === 0;

  return (
    <>
      {agentsQuery.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : agents.length === 0 ? (
        <EmptyState icon={<Bot />} title={t('empty')}>
          {t('emptyHint')}
        </EmptyState>
      ) : nothing ? (
        <EmptyState icon={<Bot />}>{tPool('noMatch')}</EmptyState>
      ) : (
        <Stack gap={5}>
          {groups.agents.length > 0 && (
            <TeamAiAgentTable label={t('groupAgents')} agents={groups.agents} {...tableProps} />
          )}
          {groups.templates.length > 0 && (
            <Stack gap={2}>
              <TeamAiAgentTable
                label={t('templates')}
                agents={groups.templates}
                copyCounts={copyCounts}
                {...tableProps}
              />
              <Text size="xs" tone="muted">
                {t('templatesHint')}
              </Text>
            </Stack>
          )}
        </Stack>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('delete')}
          confirmLabel={t('delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteAgent.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t.rich('deleteMessage', {
              name: deleting.name,
              v: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
