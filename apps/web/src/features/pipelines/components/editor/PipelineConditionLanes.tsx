'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { BranchingStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { replaceStep, type Branch } from '../../utils/editorState';
import PipelineStepLane from './PipelineStepLane';
import { Box, Inline, Stack, Text } from '@/design-system';

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
    <Box marginTop={1} padStart={3} className="@container ms-4 border-s">
      <div className="grid gap-2 @lg:grid-cols-2">
        {BRANCHES.map(({ branch, end }) => (
          <Stack gap={1} pad={2} key={branch} className="min-w-0 rounded-md border border-dashed">
            <Inline gap={2} justify="between">
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
                step[end] && (
                  <Text as="span" size="xs" tone="muted">
                    {t('endsRun')}
                  </Text>
                )
              )}
            </Inline>
            <PipelineStepLane lane={{ parentId: step.id, branch }} steps={step[branch]} />
          </Stack>
        ))}
      </div>
    </Box>
  );
}
