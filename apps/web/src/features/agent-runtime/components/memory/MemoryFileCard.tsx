'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Card, IconButton, LimitMeter, Stack, Text, TextArea } from '@/design-system';
import Markdown from '@/components/common/Markdown';
import MarkdownField from '@/components/helena/MarkdownField';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';
import type { AgentInventoryMemory } from '@/lib/api/endpoints/agents';
import AgentRuntimeActionState from '@/features/teams/components/ai-agents/AgentRuntimeActionState';
import { useQueueRuntimeAction } from '@/features/teams/services/agentLearning.service';
import { actionOn, MEMORY_ACTIONS } from '@/features/teams/utils/agentLearning';
import { withinLimit, type SizeLimit } from '../../utils/sizeLimits';
import { hasEntries, joinEntries, MAX_MEMORY_CHARS, parseEntries } from '../../utils/memoryEntries';

// One memory file of the agent, read as people read it: the entries of a Hermes file as a
// list (never the "§" between them), any other file as Markdown. Where the agent's runtime
// carries out the owner's edits, "Bearbeiten" changes the file in the same form (entries, or
// the Markdown editor of Wissen) and "Leeren" clears it.
export default function MemoryFileCard({
  teamId,
  agentId,
  entry,
  title,
  hint,
  actions,
  editable,
  limit,
}: {
  teamId: number;
  agentId: number;
  entry: AgentInventoryMemory;
  title: string;
  hint: string;
  actions: RuntimeAction[] | undefined;
  editable: boolean;
  // What the server says the file may hold; absent, only the API's own cap applies.
  limit?: SizeLimit;
}) {
  const t = useTranslations('agentPages.memory');
  const queue = useQueueRuntimeAction(teamId, agentId);
  const [mode, setMode] = useState<'read' | 'edit' | 'clear'>('read');
  const canEdit = editable && entry.sha256 != null && !entry.truncated;
  const waiting = actionOn(actions, entry.file, MEMORY_ACTIONS);
  const entries = hasEntries(entry.content);
  const list = entries ? parseEntries(entry.content) : [];

  const write = (content: string) =>
    queue.mutateAsync({
      kind: 'write-memory',
      file: entry.file,
      content,
      baseSha256: entry.sha256!,
    });

  return (
    <Card
      title={title}
      meta={hint}
      actions={
        canEdit && mode === 'read' ? (
          <>
            <Button size="small" icon={<Pencil />} onClick={() => setMode('edit')}>
              {t('edit')}
            </Button>
            {entry.content.trim() && (
              <Button size="small" variant="ghost" onClick={() => setMode('clear')}>
                {t('clear')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {mode === 'edit' ? (
        <MemoryEditor
          entry={entry}
          limit={limit}
          asEntries={entries || !entry.content.trim()}
          onCancel={() => setMode('read')}
          onSave={async (content) => {
            await write(content);
            setMode('read');
          }}
        />
      ) : entry.content.trim() ? (
        entries ? (
          <ul className="ds-memory-entries">
            {list.map((text, index) => (
              <li key={index}>
                <Markdown>{text}</Markdown>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ds-memory-text">
            <Markdown>{entry.content}</Markdown>
          </div>
        )
      ) : (
        <Text size="sm" tone="muted">
          {t('empty')}
        </Text>
      )}
      {mode === 'read' && (
        <Stack gap={1}>
          {entry.truncated && (
            <Text size="xs" tone="muted">
              {t('truncated')}
            </Text>
          )}
          {limit ? (
            <LimitMeter
              used={limit.used || (entry.chars ?? entry.content.length)}
              limit={limit.limit}
              truncated={limit.truncated}
            />
          ) : (
            entry.chars != null && (
              <Text size="xs" tone="faint" tabular>
                {t('size', { chars: entry.chars })}
              </Text>
            )
          )}
          <AgentRuntimeActionState action={waiting} />
        </Stack>
      )}
      {mode === 'clear' && (
        <ConfirmDialog
          title={t('clearTitle', { title })}
          confirmLabel={t('clear')}
          onConfirm={async () => {
            await write('');
            setMode('read');
          }}
          onClose={() => setMode('read')}
        >
          <p>{t('clearBody')}</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function MemoryEditor({
  entry,
  limit,
  asEntries,
  onCancel,
  onSave,
}: {
  entry: AgentInventoryMemory;
  limit?: SizeLimit;
  asEntries: boolean;
  onCancel: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const t = useTranslations('agentPages.memory');
  const tCommon = useTranslations('common');
  const [list, setList] = useState(() => (asEntries ? parseEntries(entry.content) : []));
  const [text, setText] = useState(entry.content);
  const [busy, setBusy] = useState(false);
  const content = asEntries ? joinEntries(list) : text;
  const max = limit?.limit ?? MAX_MEMORY_CHARS;
  const tooLong = !withinLimit(content.length, max);

  async function save() {
    setBusy(true);
    try {
      await onSave(content);
    } catch {
      // Toasted by the global mutation handler; the editor stays open for a retry.
      setBusy(false);
    }
  }

  return (
    <Stack gap={3}>
      {asEntries ? (
        <Stack gap={2}>
          {list.map((item, index) => (
            <div key={index} className="ds-memory-edit-row">
              <TextArea
                rows={2}
                aria-label={t('entryLabel', { index: index + 1 })}
                value={item}
                dir="auto"
                onChange={(event) =>
                  setList((current) =>
                    current.map((value, i) => (i === index ? event.target.value : value)),
                  )
                }
              />
              <IconButton
                label={t('removeEntry', { index: index + 1 })}
                size="small"
                onClick={() => setList((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              size="small"
              icon={<Plus />}
              onClick={() => setList((current) => [...current, ''])}
            >
              {t('addEntry')}
            </Button>
          </div>
        </Stack>
      ) : (
        <MarkdownField
          value={text}
          onChange={setText}
          label={entry.file}
          placeholder={t('placeholder')}
        />
      )}
      <LimitMeter used={content.length} limit={max} truncated={limit?.truncated} />
      <div className="ds-memory-edit-actions">
        <Button onClick={onCancel} disabled={busy}>
          {tCommon('cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={busy || tooLong || content === entry.content}
        >
          {tCommon('save')}
        </Button>
      </div>
    </Stack>
  );
}
