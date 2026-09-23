import { useTranslations } from 'next-intl';
import Markdown from '@/components/common/Markdown';
import type { AgentInventoryMemory } from '@/lib/api/endpoints/agents';

// The memory Hermes keeps for the agent. Hermes writes it, so Plan only shows it.
export default function AgentMemoryFiles({ memory }: { memory: AgentInventoryMemory[] }) {
  const t = useTranslations('teams.agents.abilities');

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t('memory')}</p>
        <p className="text-xs text-muted-foreground">{t('memoryHint')}</p>
      </div>
      {memory.map((entry) => (
        <div key={entry.file} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t(entry.file === 'MEMORY.md' ? 'memoryNotes' : 'memoryUser')} ·{' '}
            <code>{entry.file}</code>
          </p>
          {entry.content.trim() ? (
            <div className="max-h-72 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 text-sm">
              <Markdown>{entry.content}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('memoryEmpty')}</p>
          )}
          {entry.truncated && (
            <p className="text-xs text-muted-foreground">{t('memoryTruncated')}</p>
          )}
        </div>
      ))}
    </div>
  );
}
