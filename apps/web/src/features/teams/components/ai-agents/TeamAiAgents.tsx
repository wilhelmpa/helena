import { useState } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery, useDeleteAiAgent } from '@/services/aiAgents.service';
import { useIntegrationCatalogQuery } from '@/services/integrations.service';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useAgentSection } from '../../context/agentSection';
import TeamAiAgentTable from './TeamAiAgentTable';
import { TeamAiAgentSheet } from './TeamAiAgentSheet';
import { TeamAiAgentRunsSheet } from './TeamAiAgentRunsSheet';
import { integrationLabel } from '@/utils/integrationLabels';
import { useTranslations } from 'next-intl';

// The agents of a team: bot users that issues can be delegated to in any project the
// team attaches them to, and below them the templates projects copy their specialists
// from. An external agent is driven through the API; an internal agent runs on the
// built-in runtime and carries provider/model/instructions/tools. Creating and editing
// happen in the same full-width sheet, which also owns an external agent's API key:
// the sheet reveals it once on create and is where it is regenerated.
export default function TeamAiAgents() {
  const t = useTranslations('teams.agents');
  const { teamId } = useAgentSection();
  const agentsQuery = useAiAgentsQuery(teamId);
  const agents = agentsQuery.data ?? [];
  const deleteAgent = useDeleteAiAgent(teamId);
  // The integration catalog maps a provider key to a readable label for the meta row.
  const catalog = useIntegrationCatalogQuery(teamId).data ?? [];

  // The agent the sheet edits, by id; null means the sheet is closed. Creating one is
  // the section's own sheet, above this list.
  const [editingId, setEditingId] = useState<number | null>(null);
  // The agent whose run history sidebar is open.
  const [runsAgent, setRunsAgent] = useState<AiAgent | null>(null);
  const [deleting, setDeleting] = useState<AiAgent | null>(null);

  const editing = agents.find((a) => a.id === editingId) ?? null;
  const templates = agents.filter((a) => a.template);
  const tableProps = {
    providerLabel: (key: string) => integrationLabel(catalog, key),
    onEdit: (agent: AiAgent) => setEditingId(agent.id),
    onRuns: setRunsAgent,
    onDelete: setDeleting,
  };

  return (
    <>
      {agentsQuery.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : agents.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div className="space-y-8">
          <TeamAiAgentTable agents={agents.filter((a) => !a.template)} {...tableProps} />
          {templates.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">{t('templates')}</h2>
                <p className="text-xs text-muted-foreground">{t('templatesHint')}</p>
              </div>
              <TeamAiAgentTable agents={templates} {...tableProps} />
            </section>
          )}
        </div>
      )}

      <TeamAiAgentSheet
        open={editingId != null}
        agent={editing}
        onClose={() => setEditingId(null)}
      />

      <TeamAiAgentRunsSheet agent={runsAgent} onClose={() => setRunsAgent(null)} />

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
