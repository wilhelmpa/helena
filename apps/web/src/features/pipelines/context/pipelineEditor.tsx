'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type {
  DefinitionIssue,
  PipelineContext,
  PipelineDefinition,
} from '@/lib/api/endpoints/pipelines';

// The draft the builder shows and what its parts need around it: whether it is a
// template, the pickers' context, the problems the API named, the selected step and how
// to change the draft. Provided once by the editor (and by a read-only version view) so
// the lanes, cards and inspector read it instead of threading it through every level.
export interface PipelineEditorValue {
  definition: PipelineDefinition;
  template: boolean;
  context: PipelineContext | undefined;
  issues: DefinitionIssue[];
  editable: boolean;
  selectedId: string | null;
  select: (id: string | null) => void;
  change: (update: (definition: PipelineDefinition) => PipelineDefinition) => void;
}

const PipelineEditorContext = createContext<PipelineEditorValue | null>(null);

export function PipelineEditorProvider({
  value,
  children,
}: {
  value: PipelineEditorValue;
  children: ReactNode;
}) {
  return <PipelineEditorContext.Provider value={value}>{children}</PipelineEditorContext.Provider>;
}

export function usePipelineEditor(): PipelineEditorValue {
  const value = useContext(PipelineEditorContext);
  if (!value) throw new Error('usePipelineEditor outside PipelineEditorProvider');
  return value;
}
