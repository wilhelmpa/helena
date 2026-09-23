'use client';

import { useEffect, useState } from 'react';
import type { Pipeline, PipelineDefinition } from '@/lib/api/endpoints/pipelines';

export interface PipelineDraft {
  name: string;
  description: string;
  definition: PipelineDefinition;
}

const draftOf = (pipeline: Pipeline): PipelineDraft => ({
  name: pipeline.name,
  description: pipeline.description,
  definition: pipeline.definition,
});

const same = (a: PipelineDraft, b: PipelineDraft) => JSON.stringify(a) === JSON.stringify(b);

// The workflow as the editor holds it, against the saved version it started from. A
// newer saved version replaces an unchanged draft; a changed one keeps its base, so its
// save names that version and is refused when someone saved in between.
export function usePipelineDraft(pipeline: Pipeline) {
  const [base, setBase] = useState(pipeline);
  const [draft, setDraft] = useState(() => draftOf(pipeline));
  const dirty = !same(draft, draftOf(base));

  useEffect(() => {
    if (pipeline.version === base.version && pipeline.updatedAt === base.updatedAt) return;
    if (dirty) return;
    setBase(pipeline);
    setDraft(draftOf(pipeline));
  }, [pipeline, base, dirty]);

  return {
    draft,
    base,
    dirty,
    setDraft,
    // After a save: the saved workflow is the new base and the draft.
    reset: (saved: Pipeline) => {
      setBase(saved);
      setDraft(draftOf(saved));
    },
  };
}
