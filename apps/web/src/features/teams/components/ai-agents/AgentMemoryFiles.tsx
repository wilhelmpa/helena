import { useTranslations } from 'next-intl';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';
import type { AgentInventoryMemory } from '@/lib/api/endpoints/agents';
import AgentMemoryEntry from './AgentMemoryEntry';

// What the owner can do about the agent's memory, when its runner carries it out.
export interface MemoryControls {
  agentId: number;
  actions: RuntimeAction[] | undefined;
}

// The memory Hermes keeps for the agent, as its runner last reported it. The owner
// edits or clears a file here; the runner writes it on its next sync.
export default function AgentMemoryFiles({
  memory,
  controls,
}: {
  memory: AgentInventoryMemory[];
  controls: MemoryControls | null;
}) {
  const t = useTranslations('teams.agents.abilities');

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t('memory')}</p>
        <p className="text-xs text-muted-foreground">{t('memoryHint')}</p>
      </div>
      {memory.map((entry) => (
        <AgentMemoryEntry key={entry.file} entry={entry} controls={controls} />
      ))}
    </div>
  );
}
