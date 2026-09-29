import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery, useDeleteAiAgent } from '@/services/aiAgents.service';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useAgentSection } from '../../context/agentSection';
import TeamAiAgentTable from './TeamAiAgentTable';
import { TeamAiAgentSheet } from './TeamAiAgentSheet';
import { useTranslations } from 'next-intl';
import { Bot } from 'lucide-react';
import { EmptyState, Stack, Text } from '@/design-system';
import { poolGroups } from '../../utils/agentPool';

// The agents of a team: bot users that issues can be delegated to in any project the
// team attaches them to, and below them the templates projects copy their specialists
// from. An agent is driven through the API by its runner. Creating and editing happen
// in the same full-width sheet, which also owns the agent's API key: the sheet reveals
// it once on create and is where it is regenerated.
export default function TeamAiAgents() {
  const t = useTranslations('teams.agents');
  const { teamId } = useAgentSection();
  const agentsQuery = useAiAgentsQuery(teamId);
  const agents = agentsQuery.data ?? [];
  const deleteAgent = useDeleteAiAgent(teamId);

  // The agent the sheet edits, by id; null means the sheet is closed. Creating one is
  // the section's own sheet, above this list.
  const [editingId, setEditingId] = useState<number | null>(null);
  // The section the sheet opens on besides its defaults, set together with editingId
  // below; cleared once the sheet closes so reopening a different agent by hand starts
  // from the usual defaults again.
  const [openSection, setOpenSection] = useState<string | undefined>();
  // The tab and the run a deep link opens (`&tab=runs&run=<id>`).
  const [openTab, setOpenTab] = useState<string | undefined>();
  const [openRun, setOpenRun] = useState<number | null>(null);
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
    const id =
      requested === 'home'
        ? agents.find((agent) => agent.agentRole === 'home')?.id
        : Number(requested);
    if (id != null && agents.some((a) => a.id === id)) {
      setEditingId(id);
      setOpenSection(searchParams.get('section') ?? undefined);
      setOpenTab(searchParams.get('tab') ?? undefined);
      const run = Number(searchParams.get('run'));
      setOpenRun(Number.isInteger(run) && run > 0 ? run : null);
    }
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

  const editing = agents.find((a) => a.id === editingId) ?? null;
  const groups = poolGroups(agents);
  // How many project copies each template has: "0 Kopien" on its row says it is unused.
  const copyCounts = new Map<number, number>();
  for (const agent of agents) {
    if (agent.sourceTemplateId == null) continue;
    copyCounts.set(agent.sourceTemplateId, (copyCounts.get(agent.sourceTemplateId) ?? 0) + 1);
  }
  const tableProps = {
    onEdit: (agent: AiAgent) => setEditingId(agent.id),
    // The runs are a tab of the agent's own page.
    onRuns: (agent: AiAgent) => {
      setEditingId(agent.id);
      setOpenTab('runs');
    },
    onDelete: setDeleting,
  };

  return (
    <>
      {agentsQuery.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : agents.length === 0 ? (
        <EmptyState icon={<Bot />} title={t('empty')}>
          {t('emptyHint')}
        </EmptyState>
      ) : (
        <Stack gap={5}>
          <TeamAiAgentTable label={t('groupAgents')} agents={groups.agents} {...tableProps} />
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

      <TeamAiAgentSheet
        open={editingId != null}
        agent={editing}
        onClose={() => {
          setEditingId(null);
          setOpenSection(undefined);
          setOpenTab(undefined);
          setOpenRun(null);
        }}
        initialOpenSection={openSection}
        initialTab={openTab}
        initialRunId={openRun}
      />

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
