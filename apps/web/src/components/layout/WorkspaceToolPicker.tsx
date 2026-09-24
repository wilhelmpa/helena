'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PanelTool } from '@/extensions/panelTools';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Picks the tool an area of the workspace layout shows: every panel tool, the built-ins
// and plugins' (extensions/panelTools.tsx). A tool another area already shows swaps
// places with this one, so the menu marks it instead of hiding it. The trigger is the
// tool's own icon with a small chevron, at the start of the area's header.
export default function WorkspaceToolPicker({
  tools,
  current,
  shown,
  labels,
  onPick,
}: {
  tools: readonly PanelTool[];
  current: WorkspaceToolId;
  // The tools the layout's areas show right now.
  shown: readonly WorkspaceToolId[];
  labels: Record<WorkspaceToolId, string>;
  onPick: (tool: WorkspaceToolId) => void;
}) {
  const t = useTranslations('nav.layout');
  const Icon = tools.find((tool) => tool.id === current)?.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('pickTool', { tool: labels[current] ?? current })}
          title={t('pickTool', { tool: labels[current] ?? current })}
          className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
        >
          {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('tools')}
        </DropdownMenuLabel>
        {tools.map((tool) => {
          const ToolIcon = tool.Icon;
          const active = tool.id === current;
          const elsewhere = !active && shown.includes(tool.id);
          return (
            <DropdownMenuItem
              key={tool.id}
              role="menuitemradio"
              aria-checked={active}
              onSelect={() => onPick(tool.id)}
              className={cn(active && 'font-medium')}
            >
              <ToolIcon />
              <span className="min-w-0 flex-1 truncate">{labels[tool.id] ?? tool.id}</span>
              {active ? (
                <Check className="text-muted-foreground" aria-hidden="true" />
              ) : elsewhere ? (
                <span className="text-xs text-muted-foreground">{t('swap')}</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
