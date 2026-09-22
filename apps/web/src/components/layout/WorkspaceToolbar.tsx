'use client';

import type { LucideIcon } from 'lucide-react';
import { Code2, Folder, Globe2, Inbox, Mail, MessageSquare, PlugZap, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WORKSPACE_TOOL_IDS, type WorkspaceToolId } from '@/utils/workspaceTools';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const ICONS: Record<WorkspaceToolId, LucideIcon> = {
  chat: MessageSquare,
  terminal: Terminal,
  code: Code2,
  browser: Globe2,
  files: Folder,
  inbox: Inbox,
  mail: Mail,
  connections: PlugZap,
};

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
  return (
    <nav
      className="flex h-full min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto"
      aria-label={t('tools')}
    >
      <div className="ms-auto flex h-full min-w-max items-center gap-1">
        {WORKSPACE_TOOL_IDS.map((tool) => {
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
                    'flex h-full w-9 shrink-0 items-center justify-center border-b-2 border-transparent text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                    active && 'border-primary text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
