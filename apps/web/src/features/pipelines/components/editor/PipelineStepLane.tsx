'use client';

import { Fragment } from 'react';
import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { useDndSensors } from '@/lib/dnd';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { moveStep, type LaneRef } from '../../utils/editorState';
import PipelineAddStep from './PipelineAddStep';
import PipelineStepCard from './PipelineStepCard';

// The steps of one lane in run order. Each lane sorts on its own, so a drag reorders
// steps within the lane and never moves one into another lane. Whether the lane can be
// edited is known only once the permissions have loaded; the sortable list is mounted
// anew when it changes, because dnd-kit wants the same sensors for the life of a
// DndContext (see useDndSensors).
export default function PipelineStepLane({
  lane,
  steps,
}: {
  lane: LaneRef;
  steps: PipelineStep[];
}) {
  const { editable } = usePipelineEditor();
  return (
    <SortableLane key={editable ? 'edit' : 'read'} lane={lane} steps={steps} editable={editable} />
  );
}

function SortableLane({
  lane,
  steps,
  editable,
}: {
  lane: LaneRef;
  steps: PipelineStep[];
  editable: boolean;
}) {
  const { change } = usePipelineEditor();
  const sensors = useDndSensors(!editable);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    change((current) => ({
      ...current,
      steps: moveStep(current.steps, lane, String(active.id), String(over.id)),
    }));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-1">
          {steps.map((step, index) => (
            <Fragment key={step.id}>
              {editable && index > 0 && (
                <li>
                  <PipelineAddStep lane={lane} index={index} compact />
                </li>
              )}
              <PipelineStepCard step={step} />
            </Fragment>
          ))}
          {editable && (
            <li>
              <PipelineAddStep lane={lane} index={steps.length} />
            </li>
          )}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
