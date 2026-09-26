import { Fragment, useEffect, useRef, useState } from 'react';
import { useWebLinks } from '@/context/webLinks';
import { webLinkKind } from '@/utils/webLinkNavigation';
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
import { CAPTURE_PREFIX, substringFilter } from '@/utils/commandFilter';
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
  const webLinks = useWebLinks();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<CommandPage | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const capture = useCaptureMutation();
  // The highlighted item. While typing, cmdk highlights the first item it has, and the
  // search results arrive later than the "save this" actions: Enter then saved the
  // typed text instead of opening the hit the reader was looking at. So the palette
  // moves the highlight to the best result once results are in, unless the reader
  // chose an item with the keys or the pointer.
  const [selected, setSelected] = useState('');
  const chosen = useRef(false);

  // Reset the query, the filter and the open submenu whenever the palette closes, so
  // it reopens at the top level and empty.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setPage(null);
      setKind(null);
      chosen.current = false;
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
  // Results for the typed text are still on their way.
  const pending =
    searching && (query.trim() !== debounced.trim() || search.isFetching || everything.isFetching);

  // After each render of new results: a "save this" action (or nothing) highlighted by
  // cmdk itself gives way to the first real item, which cmdk's ranking puts on top.
  useEffect(() => {
    if (!open || page || chosen.current) return;
    if (selected && !selected.startsWith(CAPTURE_PREFIX)) return;
    const id = requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(
        '[role="dialog"] [data-slot="command-list"] [cmdk-item]:not([data-disabled="true"])',
      );
      const value = first?.getAttribute('data-value');
      if (value && !value.startsWith(CAPTURE_PREFIX) && value !== selected) setSelected(value);
    });
    return () => cancelAnimationFrame(id);
  }, [open, page, selected, search.data, everything.data, pending, query, kind]);

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
    const kind = webLinkKind(hit.href, window.location.href);
    if (kind === 'web') webLinks?.open(hit.href, hit.projectKey);
    else if (kind === 'native') router.push(hit.href);
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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      filter={substringFilter}
      value={selected}
      onValueChange={setSelected}
    >
      <CommandInput
        placeholder={page ? page.placeholder : t('placeholder')}
        value={query}
        onValueChange={(value) => {
          chosen.current = false;
          setQuery(value);
        }}
        // Backspace on an empty input leaves the submenu, the way a nested menu
        // closes with the left arrow.
        onKeyDown={(e) => {
          if (page && e.key === 'Backspace' && query === '') {
            e.preventDefault();
            setPage(null);
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) {
            chosen.current = true;
            return;
          }
          // Enter while the results are still loading must not save the typed text
          // just because the save action was the only item so far.
          if (
            e.key === 'Enter' &&
            pending &&
            !chosen.current &&
            selected.startsWith(CAPTURE_PREFIX)
          ) {
            e.preventDefault();
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
                onClick={() => {
                  chosen.current = false;
                  setKind(source);
                }}
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
      <CommandList onPointerMove={() => (chosen.current = true)}>
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
