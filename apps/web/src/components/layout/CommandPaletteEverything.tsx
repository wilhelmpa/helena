import { Fragment } from 'react';
import {
  Bot,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  Paperclip,
  SquareCheck,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KnowledgeHit } from '@/lib/api/endpoints/everything';
import { CAPTURE_PREFIX, KNOWLEDGE_PREFIX } from '@/utils/commandFilter';
import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command';

// The palette's results from the one search over every source the reader may open:
// tasks, notes and files, mail, chats, agent runs, comments, grouped by kind in the
// server's order. The server collapses a thread or a task with its comments into one
// hit. While typing, a last group saves the typed text into the knowledge.

export const SOURCE_ORDER = ['issue', 'vault', 'mail', 'chat', 'run', 'comment'] as const;

function iconOf(hit: KnowledgeHit): LucideIcon {
  switch (hit.source) {
    case 'issue':
      return SquareCheck;
    case 'comment':
      return MessageSquare;
    case 'mail':
      return Mail;
    case 'chat':
      return MessagesSquare;
    case 'run':
      return Bot;
    case 'vault':
      if (hit.metadata.kind === 'note') return FileText;
      return hit.path?.toLowerCase().endsWith('.canvas') ? LayoutDashboard : Paperclip;
    default:
      return FileText;
  }
}

// The small tag after a hit: the task's identifier, else its project.
function tagOf(hit: KnowledgeHit): string | null {
  const identifier = hit.metadata.identifier;
  if (typeof identifier === 'string' && (hit.source === 'issue' || hit.source === 'comment')) {
    return identifier;
  }
  return hit.projectKey;
}

export default function CommandPaletteEverything({
  hits,
  fetching,
  query,
  canCapture,
  canJournal,
  onOpen,
  onCapture,
}: {
  hits: KnowledgeHit[];
  fetching: boolean;
  query: string;
  canCapture: boolean;
  canJournal: boolean;
  onOpen: (hit: KnowledgeHit) => void;
  onCapture: (target: 'inbox' | 'journal') => void;
}) {
  const t = useTranslations('palette');
  const tSource = useTranslations('knowledge.source');
  const groups = SOURCE_ORDER.map((source) => ({
    source,
    hits: hits.filter((hit) => hit.source === source),
  })).filter((group) => group.hits.length > 0);
  const others = hits.filter(
    (hit) => !SOURCE_ORDER.includes(hit.source as (typeof SOURCE_ORDER)[number]),
  );
  let index = 0;
  const text = query.trim();

  return (
    <>
      {hits.length === 0 && fetching && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t('knowledge')}>
            <CommandItem value={`${KNOWLEDGE_PREFIX}0`} disabled>
              <FileText />
              <span className="text-muted-foreground">{t('searching')}</span>
            </CommandItem>
          </CommandGroup>
        </>
      )}
      {[...groups, ...(others.length > 0 ? [{ source: 'other', hits: others }] : [])].map(
        (group) => (
          <Fragment key={group.source}>
            <CommandSeparator />
            <CommandGroup
              heading={group.source === 'other' ? t('knowledge') : tSource(group.source as 'issue')}
            >
              {group.hits.map((hit) => {
                const Icon = iconOf(hit);
                const tag = tagOf(hit);
                const value = `${KNOWLEDGE_PREFIX}${index++}`;
                return (
                  <CommandItem key={hit.ref} value={value} onSelect={() => onOpen(hit)}>
                    <Icon />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate" dir="auto">
                        {hit.title || t('untitled')}
                      </span>
                      {hit.snippet && (
                        <span className="truncate text-xs text-muted-foreground" dir="auto">
                          {hit.snippet.replaceAll('**', '')}
                        </span>
                      )}
                    </span>
                    {tag && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {tag}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </Fragment>
        ),
      )}
      {text && (canCapture || canJournal) && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t('capture')}>
            {canCapture && (
              <CommandItem value={`${CAPTURE_PREFIX}0`} onSelect={() => onCapture('inbox')}>
                <Inbox />
                <span className="truncate">{t('captureInbox', { text })}</span>
              </CommandItem>
            )}
            {canJournal && (
              <CommandItem value={`${CAPTURE_PREFIX}1`} onSelect={() => onCapture('journal')}>
                <NotebookPen />
                <span className="truncate">{t('captureJournal', { text })}</span>
              </CommandItem>
            )}
          </CommandGroup>
        </>
      )}
    </>
  );
}
