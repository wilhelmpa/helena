import { useContext, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AgentFormPageModeCtx, useAgentDialog } from './agentFormPages';
import { AgentPage } from './AgentPage';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// A borderless section of the agent form: a quiet header (optional leading icon, a
// title, an optional one-line hint) over the fields, separated from its neighbours by
// whitespace and a hairline divider under the header, not by a card. This follows the
// project's borderless-first rule (see DESIGN.md) instead of boxing every group.
//
// The header toggles the section. Open state is controlled by the parent, which keeps
// which sections are open in one place.
export function AgentFormSection({
  icon: Icon,
  title,
  hint,
  headerRight,
  open,
  onOpenChange,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  // Optional content pinned to the right of the header (e.g. a selected/total count).
  headerRight?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  // A page of the agent dialog: the section is the page, with its title as the page's
  // heading and the fields always shown.
  // Its heading is the page's name in the dialog's list, so both read the same.
  const pageMode = useContext(AgentFormPageModeCtx);
  const dialog = useAgentDialog();
  const tPages = useTranslations('teams.agents.pages');
  if (pageMode) {
    const page = dialog?.page;
    return (
      <AgentPage
        title={page ? tPages(`items.${page}`) : title}
        hint={page ? tPages(`hints.${page}`) : hint}
        count={headerRight}
      >
        {children}
      </AgentPage>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group/section flex w-full items-center gap-2.5 border-b border-border/60 pb-2.5 text-start">
        {Icon && (
          <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/section:text-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium">{title}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
        {headerRight && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{headerRight}</span>
        )}
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground/60 transition group-hover/section:text-muted-foreground ${
            open ? 'rotate-90' : 'rtl:rotate-180'
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Indented to the header's title column (past the icon), so the fields read
            as belonging to the section above them. */}
        <div className="space-y-4 ps-6 pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
