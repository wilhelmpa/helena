import { useTranslations } from 'next-intl';
import type { RoutineMode } from '@/lib/api/endpoints/routines';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RoutineField } from './RoutineField';
import { RoutineTaskField, type RoutineTask } from './RoutineTaskField';

// What each run does: create a task, or reopen the task picked here.
export function RoutineModeField({
  projectKey,
  mode,
  task,
  onModeChange,
  onTaskChange,
}: {
  projectKey: string;
  mode: RoutineMode;
  task: RoutineTask | null;
  onModeChange: (mode: RoutineMode) => void;
  onTaskChange: (task: RoutineTask) => void;
}) {
  const t = useTranslations('routines');
  return (
    <div className="space-y-1.5">
      <div className="grid gap-4 sm:grid-cols-2">
        <RoutineField htmlFor="routine-mode" label={t('mode')}>
          <Select value={mode} onValueChange={(value) => onModeChange(value as RoutineMode)}>
            <SelectTrigger id="routine-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{t('modeNew')}</SelectItem>
              <SelectItem value="reopen">{t('modeReopen')}</SelectItem>
            </SelectContent>
          </Select>
        </RoutineField>
        {mode === 'reopen' && (
          <RoutineField label={t('task')}>
            <RoutineTaskField projectKey={projectKey} task={task} onChange={onTaskChange} />
          </RoutineField>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('coalesceHint')}</p>
    </div>
  );
}
