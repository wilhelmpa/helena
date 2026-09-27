import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ListPager from '@/components/common/ListPager';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { usePaging } from '@/hooks/usePaging';
import { TeamAiAgentRow } from './TeamAiAgentRow';
import TableCard from '@/components/common/page/TableCard';

// One table of the team's agents. The list comes whole — the sheets and the project
// screens read it too — so the page is cut here rather than asked for.
export default function TeamAiAgentTable({
  agents,
  onEdit,
  onRuns,
  onDelete,
}: {
  agents: AiAgent[];
  onEdit: (agent: AiAgent) => void;
  onRuns: (agent: AiAgent) => void;
  onDelete: (agent: AiAgent) => void;
}) {
  const t = useTranslations('teams.agents');
  const tCommon = useTranslations('common');
  const paging = usePaging();
  const work = useAgentWorkStates();
  // How many copies each template has, from the same list — cheap, and the whole
  // reason "0 copies" is worth showing right on the template's own row.
  const copyCounts = new Map<number, number>();
  for (const agent of agents) {
    if (agent.sourceTemplateId == null) continue;
    copyCounts.set(agent.sourceTemplateId, (copyCounts.get(agent.sourceTemplateId) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <TableCard>
        <Table className="table-fixed xl:min-w-[860px]">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[20%] max-lg:hidden" />
            <col className="w-[36%] max-md:hidden" />
            <col className="w-[12%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground">
                {t('agent')}
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground max-lg:hidden">
                {t('columns.triggers')}
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground max-md:hidden">
                {t('columns.configuration')}
              </TableHead>
              <TableHead className="text-end text-xs font-medium text-muted-foreground">
                {tCommon('actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paging.slice(agents).map((agent) => (
              <TeamAiAgentRow
                key={agent.id}
                agent={agent}
                work={work.get(agent.id)}
                copyCount={agent.template ? (copyCounts.get(agent.id) ?? 0) : undefined}
                onChat={() => onEdit(agent)}
                onRuns={() => onRuns(agent)}
                onEdit={() => onEdit(agent)}
                onDelete={() => onDelete(agent)}
              />
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <ListPager paging={paging} total={agents.length} />
    </div>
  );
}
