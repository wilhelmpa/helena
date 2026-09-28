import { useRef, type ReactNode } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { HeaderExtraStore } from '@/utils/headerExtraStore';
import type { HeaderLayout } from '@/lib/api/endpoints/userPreferences';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import UserMenu from '@/components/layout/UserMenu';
import ShellHeaderExtra from '@/components/layout/ShellHeaderExtra';

export default function AppHeader({
  title,
  eyebrow,
  headerLayout,
  headerExtra,
  pageSlotRef,
  pageHidden = false,
  titleLead,
}: {
  title: ReactNode;
  eyebrow: string;
  // The page's own name for the browser tab, before the breadcrumb (a task's title).
  titleLead?: string | null;
  // 'single' (the default, docs/volition-design-helena-ui.md) merges the page's own
  // view tabs/filters into this one row (`headerExtra`) and leaves language, theme
  // and the account menu to the sidebar footer. 'classic' is today's header exactly
  // as it was: those three controls here, and the page renders its own second row.
  headerLayout: HeaderLayout;
  // Null on a phone, where the page's row sits under the header instead (see Shell).
  headerExtra: HeaderExtraStore | null;
  // Receives the page slot's element (see ShellHeaderSlotCtx): a section page renders
  // its actions there instead of in a second row.
  pageSlotRef?: (element: HTMLElement | null) => void;
  // The workspace layout shows no page (the chat or a tool in its place): the page's own
  // controls stay mounted but out of sight, so they never act on a page nobody sees.
  pageHidden?: boolean;
}) {
  const single = headerLayout === 'single';
  const titleRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(titleRef, titleLead);

  return (
    // One row, three groups (docs/volition-design-helena-ui.md "einreihig"): where you
    // are (sidebar toggle, breadcrumb title), what this page offers (its view tabs and
    // filters, or its actions through the page slot), and the app's own tools on the
    // right (search, new task, the tool panels) — every control a 32px button with the
    // sidebar's hover fill and a 16px icon, a hairline between the groups.
    <header
      data-app-header=""
      className="relative flex min-h-[104px] shrink-0 items-end gap-3 border-b border-sidebar-border px-4 pt-6 pb-4 sm:px-9"
    >
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <div
        ref={titleRef}
        className={cn(
          'flex min-w-0 shrink flex-col gap-2',
          single ? 'max-w-[min(26rem,45vw)] shrink' : 'hidden max-w-40 shrink-0 2xl:block',
        )}
      >
        <span className="truncate font-mono text-[10px] font-medium tracking-[.17em] text-[#7ee0b8] uppercase">
          {eyebrow}
        </span>
        <span className="truncate text-[38px] leading-[1.04] font-medium tracking-[-.05em] max-sm:text-[28px]">
          {title}
        </span>
      </div>

      {single && headerExtra && !pageHidden ? <ShellHeaderExtra store={headerExtra} /> : null}
      {single && (
        <div
          ref={pageSlotRef}
          data-slot="app-header-page"
          className={cn(
            'flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden',
            pageHidden && 'hidden',
          )}
        />
      )}

      <div className="ms-auto flex shrink-0 items-center gap-0.5">
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
