import type { ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useHotkeyLabel } from '@/context/useHotkeys';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import type { HeaderExtraStore } from '@/utils/headerExtraStore';
import type { HeaderLayout } from '@/lib/api/endpoints/userPreferences';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import UserMenu from '@/components/layout/UserMenu';
import WorkspaceToolbar from '@/components/layout/WorkspaceToolbar';
import ShellHeaderExtra from '@/components/layout/ShellHeaderExtra';

export default function AppHeader({
  title,
  hasProject,
  onOpenCommand,
  onNewIssue,
  workspaceOpen,
  activeWorkspaceTool,
  onSelectWorkspaceTool,
  headerLayout,
  headerExtra,
}: {
  title: ReactNode;
  hasProject: boolean;
  onOpenCommand: () => void;
  onNewIssue: () => void;
  workspaceOpen: boolean;
  activeWorkspaceTool: WorkspaceToolId;
  onSelectWorkspaceTool: (tool: WorkspaceToolId) => void;
  // 'single' (the default, docs/volition-design-helena-ui.md) merges the page's own
  // view tabs/filters into this one row (`headerExtra`) and leaves language, theme
  // and the account menu to the sidebar footer. 'classic' is today's header exactly
  // as it was: those three controls here, and the page renders its own second row.
  headerLayout: HeaderLayout;
  headerExtra: HeaderExtraStore;
}) {
  const t = useTranslations('nav');
  const { can } = usePermissions();
  const paletteKey = useHotkeyLabel('palette.toggle');
  const newIssueKey = useHotkeyLabel('issue.new');
  const canCreateIssue = hasProject && can('work_items', 'create');
  const single = headerLayout === 'single';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="me-1 h-4" />
      <div
        className={cn(
          'shrink-0 truncate text-sm font-medium',
          single ? 'max-w-48' : 'hidden max-w-40 2xl:block',
        )}
      >
        {title}
      </div>

      {single && <ShellHeaderExtra store={headerExtra} />}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onOpenCommand}
            aria-label={t('searchHint', { key: paletteKey ?? '' })}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <Search className="size-4 shrink-0" />
            <span className="sr-only">{t('search')}</span>
            <kbd
              dir="ltr"
              className="ms-auto hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
            >
              {paletteKey}
            </kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('searchHint', { key: paletteKey ?? '' })}</TooltipContent>
      </Tooltip>

      {canCreateIssue && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t('newIssueHint', { key: newIssueKey ?? '' })}
              onClick={onNewIssue}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('newIssueHint', { key: newIssueKey ?? '' })}</TooltipContent>
        </Tooltip>
      )}

      <WorkspaceToolbar
        open={workspaceOpen}
        activeTool={activeWorkspaceTool}
        onSelectTool={onSelectWorkspaceTool}
      />
      {!single && (
        <>
          <LocaleToggle />
          <ThemeToggle />
          <UserMenu />
        </>
      )}
    </header>
  );
}
