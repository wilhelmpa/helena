'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Puzzle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { isBranching, isPluginStep, type PipelineStep } from '@/lib/api/endpoints/pipelines';
import { cn } from '@/lib/utils';
import { PIPELINE_STEP_ICONS } from '@/utils/pipelineStepIcons';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { usePluginTypes } from '../../hooks/usePluginTypes';
import { useStepSummary } from '../../hooks/useStepSummary';
import { isProjectIssue, stepIssues } from '../../utils/issueDisplay';
import PipelineConditionLanes from './PipelineConditionLanes';

// A step in its lane: its kind, name, what it does and how many problems it has. A
// click selects it for the inspector; the grip reorders it, by pointer or keyboard.
export default function PipelineStepCard({ step }: { step: PipelineStep }) {
  const t = useTranslations('pipelines');
  const { editable, issues, selectedId, select } = usePipelineEditor();
  const summary = useStepSummary();
  const plugins = usePluginTypes();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !editable,
  });
  const Icon = isPluginStep(step) ? Puzzle : PIPELINE_STEP_ICONS[step.type];
  const own = stepIssues(issues, step.id);
  const blocking = own.some((issue) => !isProjectIssue(issue));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-60')}
    >
      <div
        className={cn(
          'flex items-start gap-1 rounded-lg border bg-background p-2 transition-colors',
          selectedId === step.id && 'border-foreground/25 bg-accent',
        )}
      >
        {editable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-1.5 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground"
            aria-label={t('steps.drag')}
            title={t('steps.drag')}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md p-1 text-start hover:bg-accent/60"
          onClick={() => select(step.id)}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium" dir="auto">
                {step.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {plugins.stepLabel(step.type)}
              </span>
            </span>
            <span className="block truncate text-xs text-muted-foreground" dir="auto">
              {summary(step)}
            </span>
          </span>
          {own.length > 0 && (
            <Badge variant={blocking ? 'destructive' : 'outline'} className="shrink-0">
              {t('steps.problems', { count: own.length })}
            </Badge>
          )}
        </button>
      </div>
      {isBranching(step) && <PipelineConditionLanes step={step} />}
    </li>
  );
}
