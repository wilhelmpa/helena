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
// listed with their eval, so the owner sees the numbers before they are built. `thinking`
// is how much a reasoning model may think for the class (its eval runs the same way): off
// for work that only summarises or compresses, on where the evals passed with it.

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
    // Compression and image descriptions keep facts, they need no reasoning. Hermes builds
    // these calls itself: off there is Lemonade's default (local-ai-platform.md §6.7).
    thinking: 'off',
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
    // a JSON summary; thinking used up max_tokens before any answer (eval 0.25 with it)
    thinking: 'off',
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
    // passed (0.94) with thinking on
    thinking: 'low',
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
    // The chat's dictation and conversation mode (modules/voice, docs/helena-decisions/voice.md).
    // No eval gate: the case set would be recorded speech, which the eval context cannot send
    // yet; Whisper's German is measured in the voice E2E instead.
    wired: true,
  },
  {
    id: 'speech',
    label: label('speech'),
    description: description('speech'),
    // Kokoro and Piper run on the CPU; a GPU engine (MOSS-TTS) names its unit itself.
    unit: 'cpu',
    capability: 'speech',
    priority: 'interactive',
    // Not in the first set: the voice has to speak the owner's language, which the owner
    // decides (Lemonade's Kokoro speaks no German).
    inMasterDefault: false,
    // The conversation mode reads answers aloud through it (modules/voice).
    wired: true,
  },
  {
    id: 'routines',
    label: label('routines'),
    description: description('routines'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'background',
    // tool choice with arguments; passed (1.00) with thinking on
    thinking: 'low',
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
    // long summaries of the day; thinking used up max_tokens (eval 0.25 with it)
    thinking: 'off',
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
    // passed (1.00) with thinking on
    thinking: 'low',
    inMasterDefault: false,
    wired: false,
    evaluate: evaluateRoutines,
    threshold: 0.9,
  },
];
