import { Bot, MessageSquarePlus, Shield, UserMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useShell } from '@/context/shellContext';
import { useAiAgentsQuery, useUpdateAiAgent } from '@/services/aiAgents.service';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { AgentMetaChip } from './AgentMetaChip';
import { AgentTriggers } from './AgentTriggers';
import ProjectAgentAssignmentDialog from './ProjectAgentAssignmentDialog';
import TableCard from '@/components/common/page/TableCard';
import { Table, Td, Th, Tr, IconTile } from '@/design-system';

// The agents working in this project. The server leaves the Home agent out. Their role
// and instructions here are project-specific fields of the membership.
export default function ProjectAiAgents({ onNewAgent }: { onNewAgent: () => void }) {
  const t = useTranslations('settings.agents');
  const tTeam = useTranslations('teams.agents');
  const tChat = useTranslations('aiChat');
  const tCommon = useTranslations('common');
  const { onChatWithAgent, project } = useShell();
  const { can, isAdmin } = usePermissions();
  const { teamId } = useAgentSection();
  const canManageAgents = useAgentCan()('edit');
  const query = useAiAgentsQuery(teamId, project?.project.id);
  const updateAgent = useUpdateAiAgent(teamId);
  const paging = usePaging();
  const agents = query.data ?? [];
  // The project's agents come in one list — it is read whole by the chat panel and the
  // schedule editor too — so the page is cut here rather than asked for.
  const shown = paging.slice(agents);

  if (query.isPending) return <ListSkeleton rows={3} rowClassName="h-12" />;
  if (agents.length === 0)
    return (
      <EmptyState title={t('emptyHint')} description="">
        {can('ai_agents', 'create') && (
          <Button size="sm" onClick={onNewAgent}>
            {tTeam('newAgent')}
          </Button>
        )}
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      <TableCard>
        <Table stack={false} className="table-fixed xl:min-w-[640px]">
          <colgroup>
            <col className="w-[25%]" />
            <col className="w-[25%] max-md:hidden" />
            <col className="w-[14%] max-md:hidden" />
            <col className="w-[25%] max-md:hidden" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>{tTeam('agent')}</Th>
              <Th className="max-md:hidden">{t('assignment')}</Th>
              <Th className="max-md:hidden">{tTeam('columns.triggers')}</Th>
              <Th className="max-md:hidden">{tTeam('columns.configuration')}</Th>
              <Th alignment="end">{tCommon('actions')}</Th>
            </Tr>
          </thead>
          <tbody>
            {shown.map((agent) => {
              const assignment = project
                ? agent.projects.find((entry) => entry.id === project.project.id)
                : undefined;
              return (
                <Tr key={agent.id} className="group/item">
                  <Td className="py-3 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconTile>
                        <Bot className="size-4" />
                      </IconTile>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{agent.name}</span>
                          <AgentPausedBadge agent={agent} />
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          @{agent.username}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="py-3 whitespace-normal max-md:hidden">
                    {assignment && (
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-medium">
                          {assignment.roleName ?? t('defaultRole')}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {assignment.instructions || t('noProjectInstructions')}
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td className="py-3 whitespace-normal max-md:hidden">
                    <AgentTriggers agent={agent} />
                  </Td>
                  <Td className="py-3 whitespace-normal max-md:hidden">
                    <div className="flex flex-col items-start gap-1">
                      <AgentRunnerStatus agent={agent} />
                      <AgentMetaChip icon={Shield}>
                        {agent.runnerScope === 'owner'
                          ? tTeam('runnerScopeOwner')
                          : tTeam('runnerScopeTeam')}
                      </AgentMetaChip>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {assignment && project && (can('members_manage', 'edit') || isAdmin) && (
                        <ProjectAgentAssignmentDialog
                          agent={agent}
                          assignment={assignment}
                          projectKey={project.project.key}
                          teamId={teamId}
                        />
                      )}
                      {project && canManageAgents && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              disabled={updateAgent.isPending}
                              aria-label={t('removeFromProject')}
                              onClick={() =>
                                updateAgent.mutate({
                                  id: agent.id,
                                  patch: {
                                    projectIds: agent.projects
                                      .filter((entry) => entry.id !== project.project.id)
                                      .map((entry) => entry.id),
                                  },
                                })
                              }
                            >
                              <UserMinus className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('removeFromProject')}</TooltipContent>
                        </Tooltip>
                      )}
                      {assignment && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              aria-label={tChat('newChat')}
                              onClick={() => onChatWithAgent(agent.id)}
                            >
                              <MessageSquarePlus className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{tChat('newChat')}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableCard>
      <ListPager paging={paging} total={agents.length} />
    </div>
  );
}
