'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { useOfferedPanelTools } from '@/extensions/panelTools';
import { usePanelToolLabel } from '@/extensions/pluginPanelTools';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// The header's tool buttons: the panel tools the registry puts in the header
// (extensions/panelTools.tsx; chat, terminal, code, notes, browser, mail and plugins' tools),
// 32px icon buttons with the sidebar's hover and active fill, each with a tooltip. On a
// phone only the pinned tool (chat) stays in the row and the rest open from one overflow
// menu, so the single-row header never wraps or scrolls sideways.
export default function WorkspaceToolbar({
  shown,
  onSelectTool,
}: {
  // The tools the workspace layout shows right now, which the bar marks as active.
  shown: readonly WorkspaceToolId[];
  onSelectTool: (tool: WorkspaceToolId) => void;
}) {
  const t = useTranslations('nav.workspace');
  const tCommon = useTranslations('common');
  const label = usePanelToolLabel();
  const tools = useOfferedPanelTools().filter((tool) => tool.inHeader);
  const overflow = tools.filter((tool) => !tool.phonePinned);
  const overflowActive = overflow.some((tool) => shown.includes(tool.id));

  return (
    <nav className="flex h-full shrink-0 items-center gap-0.5" aria-label={t('tools')}>
      {tools.map((tool) => {
        const Icon = tool.Icon;
        const active = shown.includes(tool.id);
        const name = label(tool);
        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={name}
                aria-pressed={active}
                onClick={() => onSelectTool(tool.id)}
                className={cn(
                  'size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                  tool.phonePinned ? 'flex' : 'hidden sm:flex',
                  active && 'bg-sidebar-accent text-foreground hover:bg-sidebar-accent',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
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
            const Icon = tool.Icon;
            const active = shown.includes(tool.id);
            return (
              <DropdownMenuItem
                key={tool.id}
                onSelect={() => onSelectTool(tool.id)}
                className={cn(active && 'bg-sidebar-accent font-medium')}
              >
                <Icon />
                {label(tool)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
