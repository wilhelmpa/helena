import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import type { KnowledgeHit } from '@/lib/api/endpoints/everything';
import { useIssueSearchQuery } from '@/services/issues.service';
import { useCaptureMutation, useKnowledgeFindQuery } from '@/services/everything.service';
import type { Command, CommandPage, CommandSection } from '@/utils/commands';
import { substringFilter } from '@/utils/commandFilter';
import CommandPaletteEverything, {
  SOURCE_ORDER,
} from '@/components/layout/CommandPaletteEverything';
import CommandPaletteIssues from '@/components/layout/CommandPaletteIssues';
import CommandPaletteRow from '@/components/layout/CommandPaletteRow';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

// Command palette (⌘K). Renders the sections it is given, in order: the commands
// for the issue in front of the user, then the board, the general commands, the
// project list and every section they may open. A command with a submenu opens a
// second level (status, priority, assignee, labels); Backspace on an empty input
// goes back. While the user is typing, an "Issues" group lists issues of the current
// project the server matches by identifier, title, description, number or custom
// fields (archived issues included), then the one search over everything else the
// reader may open (notes and files, mail, chats, agent runs, comments, tasks of other
// projects), filterable by kind, and last "save this into the knowledge".
export default function CommandPalette({
  open,
  onOpenChange,
  sections,
  currentProjectKey,
  hasProject,
  onOpenIssue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: CommandSection[];
  currentProjectKey: string | null;
  hasProject: boolean;
  onOpenIssue: (sequenceNumber: number) => void;
}) {
  const t = useTranslations('palette');
  const tSource = useTranslations('knowledge.source');
  const router = useRouter();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<CommandPage | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const capture = useCaptureMutation();

  // Reset the query, the filter and the open submenu whenever the palette closes, so
  // it reopens at the top level and empty.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setPage(null);
      setKind(null);
    }
  }, [open]);

  // Scroll the results back to the top on every query change; otherwise the list
  // keeps its previous scroll offset and a match can land mid-list out of view.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const list = document.querySelector('[data-slot="command-list"]');
      if (list) list.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [query, page, kind]);

  // Debounce the input before it drives the search requests, so a burst of
  // keystrokes issues one query, not one per character.
  const debounced = useDebouncedValue(query, 250);
  const showIssues = hasProject && (kind === null || kind === 'issue');
  const search = useIssueSearchQuery(currentProjectKey, debounced, {
    enabled: open && !page && showIssues,
  });
  const hits = search.data ?? [];
  const everything = useKnowledgeFindQuery(debounced, {
    sources: kind ? [kind] : undefined,
    enabled: open && !page,
  });
  // The current project's tasks come from the issue search above.
  const knowledgeHits = (everything.data?.items ?? []).filter(
    (hit) => !(showIssues && hit.source === 'issue' && hit.projectKey === currentProjectKey),
  );
  const counts = everything.data?.counts ?? {};
  const searching = query.trim().length > 0;
  const owner = session?.user.role === 'god';

  function run(command: Command) {
    if (command.submenu) {
      setPage(command.submenu);
      setQuery('');
      return;
    }
    if (!command.keepOpen) onOpenChange(false);
    command.run?.();
  }

  function openHit(hit: KnowledgeHit) {
    onOpenChange(false);
    if (/^https?:\/\//i.test(hit.href)) window.open(hit.href, '_blank', 'noopener');
    else router.push(hit.href);
  }

  function captureText(target: 'inbox' | 'journal') {
    const text = query.trim();
    if (!text) return;
    onOpenChange(false);
    capture.mutate(
      {
        target,
        title: text.split('\n')[0]!.slice(0, 120),
        text,
        projectKey: target === 'inbox' ? (currentProjectKey ?? undefined) : undefined,
      },
      {
        onSuccess: (saved) =>
          toast.success(target === 'journal' ? t('capturedJournal') : t('capturedInbox'), {
            action: { label: t('openCaptured'), onClick: () => router.push(saved.href) },
          }),
        onError: () => toast.error(t('captureFailed')),
      },
    );
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} filter={substringFilter}>
      <CommandInput
        placeholder={page ? page.placeholder : t('placeholder')}
        value={query}
        onValueChange={setQuery}
        // Backspace on an empty input leaves the submenu, the way a nested menu
        // closes with the left arrow.
        onKeyDown={(e) => {
          if (page && e.key === 'Backspace' && query === '') {
            e.preventDefault();
            setPage(null);
          }
        }}
      />
      {!page && searching && (
        <div
          role="toolbar"
          aria-label={t('filterKinds')}
          className="flex gap-1 overflow-x-auto border-b px-2 py-1.5"
        >
          {[null, ...SOURCE_ORDER].map((source) => {
            const count = source ? counts[source] : undefined;
            return (
              <button
                key={source ?? 'all'}
                type="button"
                aria-pressed={kind === source}
                onClick={() => setKind(source)}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                  kind === source && 'bg-accent text-foreground',
                )}
              >
                {source ? tSource(source) : t('filterAll')}
                {count ? <span className="ms-1 tabular-nums opacity-70">{count}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      <CommandList>
        <CommandEmpty>{t('noResults')}</CommandEmpty>
        {page ? (
          <CommandGroup heading={page.heading}>
            {page.items.map((command) => (
              <CommandPaletteRow key={command.id} command={command} onRun={run} />
            ))}
          </CommandGroup>
        ) : (
          sections.map((section, i) => (
            <Fragment key={section.id}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={section.heading}>
                {section.items.map((command) => (
                  <CommandPaletteRow key={command.id} command={command} onRun={run} />
                ))}
              </CommandGroup>
            </Fragment>
          ))
        )}
        {/* Issue results only appear while the user is typing, otherwise the
            palette would list the entire project on open. */}
        {!page && showIssues && searching && (hits.length > 0 || search.isFetching) && (
          <CommandPaletteIssues
            hits={hits}
            fetching={search.isFetching}
            onOpenIssue={(seq) => {
              onOpenChange(false);
              onOpenIssue(seq);
            }}
          />
        )}
        {!page && searching && (
          <CommandPaletteEverything
            hits={knowledgeHits}
            fetching={everything.isFetching}
            query={query}
            canCapture
            canJournal={owner}
            onOpen={openHit}
            onCapture={captureText}
          />
        )}
      </CommandList>
    </CommandDialog>
  );
}
