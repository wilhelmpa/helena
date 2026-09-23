import { useState } from 'react';
import { Hash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import IssuePickerDialog from '@/components/common/overlay/IssuePickerDialog';

export interface RoutineTask {
  id: number;
  identifier: string;
  title: string;
}

// The task a reopening routine reopens, picked from the project's tasks.
export function RoutineTaskField({
  projectKey,
  task,
  onChange,
}: {
  projectKey: string;
  task: RoutineTask | null;
  onChange: (task: RoutineTask) => void;
}) {
  const t = useTranslations('routines');
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2 font-normal"
        onClick={() => setPicking(true)}
      >
        <Hash className="size-4 text-muted-foreground" />
        {task ? (
          <>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {task.identifier}
            </span>
            <span className="truncate">{task.title}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('chooseTask')}</span>
        )}
      </Button>
      {picking && (
        <IssuePickerDialog
          projectKey={projectKey}
          title={t('chooseTask')}
          prompt={t('searchTasks')}
          onPick={(hit) => {
            onChange({ id: hit.id, identifier: hit.identifier, title: hit.title });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
