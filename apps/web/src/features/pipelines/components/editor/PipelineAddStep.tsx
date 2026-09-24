'use client';

import { Plus, Puzzle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { STEP_KINDS, type PluginTypeName, type StepKind } from '@/lib/api/endpoints/pipelines';
import { PIPELINE_STEP_ICONS } from '@/utils/pipelineStepIcons';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { usePluginTypes, type PluginType } from '../../hooks/usePluginTypes';
import {
  insertStep,
  laneDepth,
  MAX_CONDITION_DEPTH,
  MAX_STEPS,
  newStep,
  newPluginStep,
  stepCount,
  uniqueStepId,
  type LaneRef,
} from '../../utils/editorState';

// Adds a step of a chosen kind at a position of a lane and selects it. `compact` is
// the small button between two steps; the full one ends a lane.
export default function PipelineAddStep({
  lane,
  index,
  compact = false,
}: {
  lane: LaneRef;
  index: number;
  compact?: boolean;
}) {
  const t = useTranslations('pipelines');
  const { definition, change, select } = usePipelineEditor();
  const full = stepCount(definition.steps) >= MAX_STEPS;
  const deep = laneDepth(definition.steps, lane) >= MAX_CONDITION_DEPTH;

  const plugins = usePluginTypes();

  const add = (kind: StepKind) => {
    const id = uniqueStepId(kind, definition.steps);
    change((current) => ({
      ...current,
      steps: insertStep(
        current.steps,
        lane,
        index,
        newStep(kind, id, t(`kinds.${kind}`), current.roles),
      ),
    }));
    select(id);
  };

  // A plugin's step, with the defaults its type offers.
  const addPlugin = ({ type, info }: PluginType) => {
    const id = uniqueStepId(type, definition.steps);
    const step = newPluginStep(
      type as PluginTypeName,
      id,
      plugins.text(info.label) || type,
      info.defaults,
    );
    change((current) => ({ ...current, steps: insertStep(current.steps, lane, index, step) }));
    select(id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="mx-auto flex size-5 text-muted-foreground"
            aria-label={t('steps.addHere')}
            title={t('steps.addHere')}
          >
            <Plus />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground">
            <Plus /> {t('steps.add')}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {full ? (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            {t('steps.limit', { max: MAX_STEPS })}
          </DropdownMenuLabel>
        ) : (
          <>
            {STEP_KINDS.map((kind) => {
              const Icon = PIPELINE_STEP_ICONS[kind];
              return (
                <DropdownMenuItem
                  key={kind}
                  disabled={(kind === 'condition' || kind === 'decision') && deep}
                  className="items-start"
                  onSelect={() => add(kind)}
                >
                  <Icon className="mt-0.5" />
                  <span className="flex flex-col">
                    <span>{t(`kinds.${kind}`)}</span>
                    <span className="text-xs text-muted-foreground">{t(`kindHints.${kind}`)}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
            {plugins.steps.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t('steps.plugins')}
                </DropdownMenuLabel>
                {plugins.steps.map((entry) => (
                  <DropdownMenuItem
                    key={entry.type}
                    className="items-start"
                    onSelect={() => addPlugin(entry)}
                  >
                    <Puzzle className="mt-0.5" />
                    <span className="flex flex-col">
                      <span>{plugins.text(entry.info.label) || entry.type}</span>
                      {entry.info.description && (
                        <span className="text-xs text-muted-foreground">
                          {plugins.text(entry.info.description)}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
