import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Markdown from '@/components/common/Markdown';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { AgentInventoryMemory } from '@/lib/api/endpoints/agents';
import { useAgentSection } from '../../context/agentSection';
import { useQueueRuntimeAction } from '../../services/agentLearning.service';
import { actionOn, MEMORY_ACTIONS } from '../../utils/agentLearning';
import type { MemoryControls } from './AgentMemoryFiles';
import AgentMemoryEditDialog from './AgentMemoryEditDialog';
import AgentRuntimeActionState from './AgentRuntimeActionState';

// One memory file: its content and size, and the edit and the clearing the owner queues
// for the runner. A file past what the runner reports whole cannot be edited here.
export default function AgentMemoryEntry({
  entry,
  controls,
}: {
  entry: AgentInventoryMemory;
  controls: MemoryControls | null;
}) {
  const t = useTranslations('teams.agents.abilities');
  const tLearning = useTranslations('teams.agents.abilities.learning');
  const { teamId } = useAgentSection();
  const queue = useQueueRuntimeAction(teamId, controls?.agentId ?? 0);
  const [open, setOpen] = useState<'edit' | 'clear' | null>(null);
  const editable = controls != null && entry.sha256 != null && !entry.truncated;
  const action = actionOn(controls?.actions, entry.file, MEMORY_ACTIONS);
  const write = (content: string) =>
    queue.mutateAsync({
      kind: 'write-memory',
      file: entry.file,
      content,
      baseSha256: entry.sha256!,
    });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t(entry.file === 'MEMORY.md' ? 'memoryNotes' : 'memoryUser')} · <code>{entry.file}</code>
          {entry.chars != null && <> · {tLearning('memorySize', { chars: entry.chars })}</>}
        </p>
        {editable && (
          <span className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen('edit')}>
              {tLearning('memoryEdit')}
            </Button>
            {entry.content.trim() && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen('clear')}>
                {tLearning('memoryClear')}
              </Button>
            )}
          </span>
        )}
      </div>
      {entry.content.trim() ? (
        <div className="max-h-72 overflow-y-auto rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm">
          <Markdown>{entry.content}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('memoryEmpty')}</p>
      )}
      {entry.truncated && <p className="text-xs text-muted-foreground">{t('memoryTruncated')}</p>}
      <AgentRuntimeActionState action={action} />
      {open === 'edit' && (
        <AgentMemoryEditDialog
          file={entry.file}
          content={entry.content}
          onSave={async (content) => {
            await write(content);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'clear' && (
        <ConfirmDialog
          title={tLearning('memoryClearTitle', { file: entry.file })}
          confirmLabel={tLearning('memoryClear')}
          onConfirm={async () => {
            await write('');
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        >
          <p className="text-sm text-muted-foreground">{tLearning('memoryClearBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
