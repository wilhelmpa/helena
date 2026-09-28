import { useEffect, useRef, useState } from 'react';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { groupDefaults, type IssueGroup } from '@/utils/project';
import { useCreateIssue, useSetFieldValue } from '@/services/issues.service';
import { cn } from '@/lib/utils';

export default function InlineColumnCreate({
  project,
  group,
  onClose,
  compact = false,
}: {
  project: ProjectDetail;
  group: IssueGroup;
  onClose: () => void;
  compact?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateIssue();
  const setField = useSetFieldValue(project.project.key);
  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    if (!title.trim() || create.isPending) return;
    const { fieldValues = [], ...defaults } = groupDefaults(group.assign);
    try {
      setError(null);
      const issue = await create.mutateAsync({
        projectKey: project.project.key,
        input: {
          ...defaults,
          columnId: defaults.columnId ?? project.columns[0]?.id ?? 0,
          title: title.trim(),
        },
      });
      for (const field of fieldValues) {
        await setField.mutateAsync({
          issueId: issue.id,
          fieldId: field.fieldId,
          value: { value: field.userId },
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className={cn('rounded-md bg-card p-2', compact ? 'w-56' : 'mx-2 mb-2')}>
      <input
        ref={inputRef}
        aria-label={`Neue Aufgabe in ${group.name}`}
        placeholder="Neue Aufgabe…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }
          if (event.key === 'Escape') onClose();
        }}
        className="w-full min-w-0 bg-transparent text-sm outline-none"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
