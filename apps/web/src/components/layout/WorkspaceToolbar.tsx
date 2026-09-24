'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Code2,
  Globe2,
  Inbox,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PlugZap,
  Terminal,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { HEADER_WORKSPACE_TOOLS, type WorkspaceToolId } from '@/utils/workspaceTools';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const ICONS: Record<WorkspaceToolId, LucideIcon> = {
  chat: MessageSquare,
  terminal: Terminal,
  code: Code2,
  browser: Globe2,
  inbox: Inbox,
  mail: Mail,
  connections: PlugZap,
};

// The tool that stays in the header on a phone; the others move into the overflow menu.
const PHONE_TOOL: WorkspaceToolId = 'chat';

// The header's tool buttons (chat, terminal, code, browser, mail): 32px icon buttons
// with the sidebar's hover and active fill, each with a tooltip. On a phone only the
// chat stays in the row and the rest open from one overflow menu, so the single-row
// header never wraps or scrolls sideways.
export default function WorkspaceToolbar({
  open,
  activeTool,
  onSelectTool,
}: {
  open: boolean;
  activeTool: WorkspaceToolId;
  onSelectTool: (tool: WorkspaceToolId) => void;
}) {
  const t = useTranslations('nav.workspace');
  const tCommon = useTranslations('common');
  const overflow: WorkspaceToolId[] = HEADER_WORKSPACE_TOOLS.filter((tool) => tool !== PHONE_TOOL);
  const overflowActive = open && overflow.includes(activeTool);

  return (
    <nav className="flex h-full shrink-0 items-center gap-0.5" aria-label={t('tools')}>
      {HEADER_WORKSPACE_TOOLS.map((tool) => {
        const Icon = ICONS[tool];
        const active = open && activeTool === tool;
        const label = t(tool);
        return (
          <Tooltip key={tool}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={() => onSelectTool(tool)}
                className={cn(
                  'size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                  tool === PHONE_TOOL ? 'flex' : 'hidden sm:flex',
                  active && 'bg-sidebar-accent text-foreground hover:bg-sidebar-accent',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={tCommon('more')}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none sm:hidden',
              overflowActive && 'bg-sidebar-accent text-foreground',
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {overflow.map((tool) => {
            const Icon = ICONS[tool];
            const active = open && activeTool === tool;
            return (
              <DropdownMenuItem
                key={tool}
                onSelect={() => onSelectTool(tool)}
                className={cn(active && 'bg-sidebar-accent font-medium')}
              >
                <Icon />
                {t(tool)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
