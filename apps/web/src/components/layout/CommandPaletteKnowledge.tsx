import { FileText, Folder, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KnowledgeSearchHit } from '@/lib/api/endpoints/knowledge';
import { KNOWLEDGE_PREFIX } from '@/utils/commandFilter';
import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command';

const ICONS = { note: FileText, file: Paperclip, folder: Folder };

// The palette's "Knowledge" group: notes and files of the vault the server matched,
// in its order, with the excerpt around the match.
export default function CommandPaletteKnowledge({
  hits,
  fetching,
  onOpen,
}: {
  hits: KnowledgeSearchHit[];
  fetching: boolean;
  onOpen: (hit: KnowledgeSearchHit) => void;
}) {
  const t = useTranslations('palette');
  return (
    <>
      <CommandSeparator />
      <CommandGroup heading={t('knowledge')}>
        {hits.length === 0 && fetching && (
          <CommandItem value={`${KNOWLEDGE_PREFIX}0`} disabled>
            <FileText />
            <span className="text-muted-foreground">{t('searching')}</span>
          </CommandItem>
        )}
        {hits.map((hit, i) => {
          const Icon = ICONS[hit.kind];
          return (
            <CommandItem
              key={hit.path}
              value={`${KNOWLEDGE_PREFIX}${i}`}
              onSelect={() => onOpen(hit)}
            >
              <Icon />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate" dir="auto">
                  {hit.title}
                </span>
                {hit.snippet && (
                  <span className="truncate text-xs text-muted-foreground" dir="auto">
                    {hit.snippet.replaceAll('**', '')}
                  </span>
                )}
              </span>
              {hit.projectKey && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {hit.projectKey}
                </span>
              )}
            </CommandItem>
          );
        })}
      </CommandGroup>
    </>
  );
}
