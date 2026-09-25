'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { BranchingStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { replaceStep, type Branch } from '../../utils/editorState';
import PipelineStepLane from './PipelineStepLane';

const BRANCHES: { branch: Branch; end: 'thenEnd' | 'elseEnd' }[] = [
  { branch: 'then', end: 'thenEnd' },
  { branch: 'else', end: 'elseEnd' },
];

// The two lanes of a condition, side by side where there is room. After its lane the
// run goes on with the step after the condition, unless the lane ends the run.
// A decision step's lanes say which options lead into the first one.
export default function PipelineConditionLanes({ step }: { step: BranchingStep }) {
  const t = useTranslations('pipelines.steps');
  const { editable, change } = usePipelineEditor();

  return (
    <div className="@container ms-4 mt-1 border-s ps-3">
      <div className="grid gap-2 @lg:grid-cols-2">
        {BRANCHES.map(({ branch, end }) => (
          <div key={branch} className="min-w-0 space-y-1 rounded-lg border border-dashed p-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="max-w-full truncate">
                {step.type === 'decision'
                  ? branch === 'then'
                    ? step.thenOptions.join(', ') || t('decisionThen')
                    : t('decisionElse')
                  : t(branch === 'then' ? 'yes' : 'no')}
              </Badge>
              {editable ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t('endsRun')}
                  <Switch
                    checked={step[end]}
                    onCheckedChange={(checked) =>
                      change((current) => ({
                        ...current,
                        steps: replaceStep(current.steps, step.id, { ...step, [end]: checked }),
                      }))
                    }
                  />
                </label>
              ) : (
                step[end] && <span className="text-xs text-muted-foreground">{t('endsRun')}</span>
              )}
            </div>
            <PipelineStepLane lane={{ parentId: step.id, branch }} steps={step[branch]} />
          </div>
        ))}
      </div>
    </div>
  );
}
