import { History, MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AGENT_KIND_ICON } from '../../utils/agentKindIcon';
import { useAgentCan } from '../../context/agentSection';
import { AgentMetaRow } from './AgentMetaRow';
import { AgentTriggers } from './AgentTriggers';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

// One agent as a table row: the Agent cell holds the name, @username, an icon for the
// kind, and the projects the agent works in; the Configuration cell shows an
// internal agent's meta line (model, capability/tool/skill counts) or an external
// agent's runner presence and non-secret key prefix. Row actions
// (history/chat/edit/delete) sit in the last cell; the key itself is managed in the
// agent's sheet. `providerLabel` maps a provider key to its catalog label.
export function TeamAiAgentRow({
  agent,
  providerLabel,
  copyCount,
  onChat,
  onRuns,
  onEdit,
  onDelete,
}: {
  agent: AiAgent;
  providerLabel: (key: string) => string;
  // Set only for a template row (how many project copies of it exist); forwarded to
  // AgentRunnerStatus's template badge.
  copyCount?: number;
  onChat: () => void;
  onRuns: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('teams.agents');
  const can = useAgentCan();
  const canHistory = can('read');
  const KindIcon = AGENT_KIND_ICON[agent.kind];
  const hasMenu = canHistory || can('delete');

  // The whole row opens the agent's sheet (the same as the pencil), so the name, the
  // projects and the configuration are one click away wherever the pointer lands; the
  // action buttons stop the click from reaching the row.
  const openRow = can('edit') ? onEdit : undefined;
  return (
    <TableRow
      className={cn('group/item', openRow && 'cursor-pointer')}
      onClick={openRow}
      onKeyDown={(event) => {
        if (openRow && event.key === 'Enter' && event.target === event.currentTarget) openRow();
      }}
      tabIndex={openRow ? 0 : undefined}
    >
      <TableCell className="px-2 align-middle whitespace-normal">
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <span className="truncate text-xs text-muted-foreground max-md:hidden">
            @{agent.username}
          </span>
          <AgentPausedBadge agent={agent} />
          {agent.projects.length === 0 ? (
            <span className="ms-auto shrink-0 text-xs text-muted-foreground/80">
              {t('noProjectsShort')}
            </span>
          ) : (
            <span className="ms-auto flex shrink-0 items-center gap-1.5">
              {agent.projects.map((project) => (
                <Tooltip key={project.id}>
                  <TooltipTrigger asChild>
                    <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="font-medium">
                      {project.name} · {project.roleName ?? t('defaultProjectRole')}
                    </div>
                    <div className="text-xs opacity-80">
                      {project.instructions || t('noProjectInstructions')}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="px-2 align-middle whitespace-normal max-lg:hidden">
        <AgentTriggers agent={agent} />
      </TableCell>
      <TableCell className="px-2 align-middle whitespace-normal max-md:hidden">
        {agent.kind === 'internal' ? (
          <AgentMetaRow agent={agent} providerLabel={providerLabel} />
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <AgentRunnerStatus agent={agent} copyCount={copyCount} />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {agent.apiKeyStart ? t('apiKeyValue', { start: agent.apiKeyStart }) : t('apiKey')}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 align-middle" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          {canHistory && (
            <IconButton title={t('runHistory')} onClick={onRuns}>
              <History className="size-4" />
            </IconButton>
          )}
          {can('edit') && (
            <IconButton title={t('edit')} onClick={onEdit}>
              <Pencil className="size-4" />
            </IconButton>
          )}
          {hasMenu && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('moreActions')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {canHistory && (
                  <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={onChat}>
                    <MessageSquare />
                    {t('testChat')}
                  </DropdownMenuItem>
                )}
                {can('delete') && canHistory && <DropdownMenuSeparator />}
                {can('delete') && (
                  <DropdownMenuItem
                    className="min-h-11 sm:min-h-8"
                    variant="destructive"
                    onSelect={onDelete}
                  >
                    <Trash2 />
                    {t('delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
