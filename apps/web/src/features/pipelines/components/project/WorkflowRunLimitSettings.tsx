'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePipelineRunLimit, useSetPipelineRunLimit } from '@/services/pipelines.service';

const MIN = 1;
const MAX = 1000;
const INPUT_ID = 'workflow-run-limit-max-runs';

// The project's guard against workflows re-triggering each other without end (see
// apps/api/src/modules/pipelines/rate-limit.ts): a change one workflow's agent step
// makes to a task can start another workflow, whose own agent step change can start
// the first one again, without end. At most this many runs of any workflow may
// start on one task within an hour; past that, Plan starts none and leaves a note
// in the task's activity and in the workflow's own run history instead.
export default function WorkflowRunLimitSettings({
  projectKey,
  editable,
}: {
  projectKey: string;
  editable: boolean;
}) {
  const t = useTranslations('pipelines.project.runLimit');
  const limit = usePipelineRunLimit(projectKey);
  const save = useSetPipelineRunLimit(projectKey);
  const [value, setValue] = useState('');

  // Adopts the loaded (or just-saved) value, but never overwrites what the editor
  // is mid-typing.
  useEffect(() => {
    if (limit.data && document.activeElement?.id !== INPUT_ID) setValue(String(limit.data.maxRuns));
  }, [limit.data]);

  if (limit.isPending || !limit.data) return null;

  const parsed = Number.parseInt(value, 10);
  const invalid = !Number.isInteger(parsed) || parsed < MIN || parsed > MAX;
  const dirty = parsed !== limit.data.maxRuns;

  function submit() {
    if (invalid || !limit.data || parsed === limit.data.maxRuns) return;
    save.mutate(parsed, { onSuccess: () => toast.success(t('saved')) });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b pb-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id={INPUT_ID}
          type="number"
          min={MIN}
          max={MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={!editable}
          aria-label={t('title')}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">{t('perHour')}</span>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || invalid || save.isPending}
            onClick={submit}
          >
            {t('save')}
          </Button>
        )}
      </div>
    </div>
  );
}
