'use client';

import { Columns2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Picks the tool shown beside the active one, such as the mail composer next to the
// browser, or closes that second half again.
export default function WorkspaceSplitMenu({
  tools,
  splitTool,
  labels,
  onSplitToolChange,
}: {
  tools: readonly WorkspaceToolId[];
  splitTool: WorkspaceToolId | null;
  labels: Record<WorkspaceToolId, string>;
  onSplitToolChange: (tool: WorkspaceToolId | null) => void;
}) {
  const t = useTranslations('nav.workspace');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={splitTool ? 'secondary' : 'ghost'}
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          title={t('openBeside')}
          aria-label={t('openBeside')}
        >
          <Columns2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('openBeside')}</DropdownMenuLabel>
        {tools.map((tool) => (
          <DropdownMenuItem
            key={tool}
            onSelect={() => onSplitToolChange(tool)}
            aria-checked={splitTool === tool}
          >
            {labels[tool]}
          </DropdownMenuItem>
        ))}
        {splitTool && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSplitToolChange(null)}>
              {t('closeSplit')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
