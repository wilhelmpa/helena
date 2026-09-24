import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Info } from 'lucide-react';
import { SectionLabel } from '@/components/common/page/RowList';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  // The section the sheet opens on besides its defaults, set together with editingId
  // below; cleared once the sheet closes so reopening a different agent by hand starts
  // from the usual defaults again.
  const [openSection, setOpenSection] = useState<string | undefined>();
  // The agent whose run history sidebar is open.
  const [runsAgent, setRunsAgent] = useState<AiAgent | null>(null);
  const [deleting, setDeleting] = useState<AiAgent | null>(null);

  // A `/skills` or `/memory` chat command sends the member straight to one agent's
  // sheet: `?agent=<id>` opens it (`&section=<id>` also expands that section), and the
  // params are dropped from the URL right away so navigating back or reopening the
  // page by hand does not reopen it a second time.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const requested = searchParams.get('agent');
    if (!requested || agentsQuery.isPending) return;
    const id = Number(requested);
    if (agents.some((a) => a.id === id)) {
      setEditingId(id);
      setOpenSection(searchParams.get('section') ?? undefined);
    }
    const params = new URLSearchParams(searchParams);
    params.delete('agent');
    params.delete('section');
    router.replace(params.size > 0 ? `?${params.toString()}` : window.location.pathname);
    // Only the deep link itself should ever trigger this; agents/router are stable
    // enough here not to re-run it on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, agentsQuery.isPending]);

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
        <div className="space-y-6">
          <TeamAiAgentTable agents={agents.filter((a) => !a.template)} {...tableProps} />
          {templates.length > 0 && (
            <section>
              {/* The group label, as in the sidebar; what templates are for sits in its
                  tooltip rather than as an intro line under it. */}
              <SectionLabel
                className="px-1"
                trailing={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('templatesHint')}
                        className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{t('templatesHint')}</TooltipContent>
                  </Tooltip>
                }
              >
                {t('templates')}
              </SectionLabel>
              <TeamAiAgentTable agents={templates} {...tableProps} />
            </section>
          )}
        </div>
      )}

      <TeamAiAgentSheet
        open={editingId != null}
        agent={editing}
        onClose={() => {
          setEditingId(null);
          setOpenSection(undefined);
        }}
        initialOpenSection={openSection}
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
