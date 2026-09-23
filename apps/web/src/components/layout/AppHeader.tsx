import type { ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/hooks/usePermissions';
import { useHotkeyLabel } from '@/context/useHotkeys';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
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
  pageSlotRef,
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
  headerExtra?: ReactNode;
  // Receives the page slot's element (see ShellHeaderSlotCtx): a section page renders
  // its actions there instead of in a second row.
  pageSlotRef?: (element: HTMLElement | null) => void;
}) {
  const t = useTranslations('nav');
  const { can } = usePermissions();
  const paletteKey = useHotkeyLabel('palette.toggle');
  const newIssueKey = useHotkeyLabel('issue.new');
  const canCreateIssue = hasProject && can('work_items', 'create');
  const single = headerLayout === 'single';

  return (
    // One row, three groups (docs/volition-design-helena-ui.md "einreihig"): where you
    // are (sidebar toggle, breadcrumb title), what this page offers (its view tabs and
    // filters, or its actions through the page slot), and the app's own tools on the
    // right (search, new task, the tool panels) — every control a 32px button with the
    // sidebar's hover fill and a 16px icon, a hairline between the groups.
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-2 sm:px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <div
        className={cn(
          'min-w-0 truncate text-sm font-medium',
          single ? 'max-w-[min(26rem,45vw)] shrink' : 'hidden max-w-40 shrink-0 2xl:block',
        )}
      >
        {title}
      </div>

      {single && headerExtra && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <div className="min-w-0 flex-1 overflow-x-auto">{headerExtra}</div>
        </>
      )}
      {single && (
        <div
          ref={pageSlotRef}
          data-slot="app-header-page"
          className="flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden"
        />
      )}

      <div className="ms-auto flex shrink-0 items-center gap-0.5">
        <Separator orientation="vertical" className="me-1.5 h-4 max-sm:hidden" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenCommand}
              aria-label={t('searchHint', { key: paletteKey ?? '' })}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              <Search className="size-4 shrink-0" />
              <span className="sr-only">{t('search')}</span>
              <kbd
                dir="ltr"
                className="ms-auto hidden rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
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
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
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
      </div>
    </header>
  );
}
