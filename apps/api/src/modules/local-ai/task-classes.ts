import type { LocalAiTaskClass } from '@helena/sdk';
import {
  evaluateEmbeddings,
  evaluateHermesHelpers,
  evaluateRoutines,
  evaluateSummaries,
  evaluateTriage,
} from './evals';

// The kinds of work local AI may take (docs/helena-decisions/local-ai-platform.md §6), as
// the built-in plugin `helena.local-ai` registers them. Background work and automation only:
// interactive chats and the real work (coding, long agent tasks, the Home master, anything
// with side effects outside Helena) stay on the configured models unless the owner assigns a
// local model to an agent in the model picker.
//
// `wired` says whether Helena already sends the work to local AI. The others are the plan:
// listed with their eval, so the owner sees the numbers before they are built.

const label = (id: string) => ({ i18n: `localAi.classes.${id}.label` });
const description = (id: string) => ({ i18n: `localAi.classes.${id}.description` });

export const BUILTIN_TASK_CLASSES: LocalAiTaskClass[] = [
  {
    id: 'embeddings',
    label: label('embeddings'),
    description: description('embeddings'),
    unit: 'npu',
    capability: 'embeddings',
    priority: 'background',
    inMasterDefault: true,
    wired: true,
    evaluate: evaluateEmbeddings,
    threshold: 0.8,
  },
  {
    id: 'hermes-helpers',
    label: label('hermes-helpers'),
    description: description('hermes-helpers'),
    unit: 'gpu',
    capability: 'chat',
    priority: 'background',
    inMasterDefault: true,
    wired: true,
    evaluate: evaluateHermesHelpers,
    threshold: 0.75,
  },
  {
    id: 'summaries',
    label: label('summaries'),
    description: description('summaries'),
    unit: 'gpu',
    capability: 'chat',
    priority: 'background',
    inMasterDefault: true,
    wired: false,
    evaluate: evaluateSummaries,
    threshold: 0.75,
  },
  {
    id: 'triage',
    label: label('triage'),
    description: description('triage'),
    unit: 'npu',
    capability: 'chat',
    priority: 'background',
    inMasterDefault: true,
    wired: false,
    evaluate: evaluateTriage,
    threshold: 0.85,
  },
  {
    id: 'transcription',
    label: label('transcription'),
    description: description('transcription'),
    unit: 'npu',
    capability: 'transcription',
    priority: 'interactive',
    inMasterDefault: true,
    wired: false,
  },
  {
    id: 'routines',
    label: label('routines'),
    description: description('routines'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'background',
    inMasterDefault: false,
    wired: false,
    evaluate: evaluateRoutines,
    threshold: 0.9,
  },
  {
    id: 'reflection',
    label: label('reflection'),
    description: description('reflection'),
    unit: 'gpu',
    capability: 'chat',
    priority: 'batch',
    inMasterDefault: false,
    wired: false,
    evaluate: evaluateSummaries,
    threshold: 0.85,
  },
  {
    id: 'coordinator-triage',
    label: label('coordinator-triage'),
    description: description('coordinator-triage'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'background',
    inMasterDefault: false,
    wired: false,
    evaluate: evaluateRoutines,
    threshold: 0.9,
  },
];
