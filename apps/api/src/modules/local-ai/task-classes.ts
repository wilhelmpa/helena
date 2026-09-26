import type { LocalAiMode, LocalAiTaskClass } from '@helena/sdk';
import {
  evaluateCoordinatorTriage,
  evaluateEmbeddings,
  evaluateHermesHelpers,
  evaluateReflection,
  evaluateRoutines,
  evaluateSummaries,
  evaluateTriage,
} from './evals';
import { VOICE_REPLY_THRESHOLD, evaluateVoiceReply } from '#modules/voice/reply-eval';

// The kinds of work local AI may take (docs/helena-decisions/local-ai-platform.md §6), as
// the built-in plugin `helena.local-ai` registers them. Background work and automation only:
// interactive chats and the real work (coding, long agent tasks, the Home master, anything
// with side effects outside Helena) stay on the configured models unless the owner assigns a
// local model to an agent in the model picker.
//
// `wired` says whether Helena already sends the work to local AI, and where (the class →
// producer map is in local-ai-platform.md §7.1). `thinking` is how much a reasoning model may
// think for the class, and its eval runs the same way: off for work that only compresses,
// classifies or keeps a few facts; `low` for work whose eval passed thinking. An agent's turn
// on a local model thinks (the provider's `extra_body`, §6.7); one of a class with `off` is
// started on the server's provider without thinking (`classModelNow` hands `none`).
//
// Work that runs as an agent's turn (a digest, a routine's task, a coordinator's first plan, a
// reflection) is handed its local model when the run starts (`classModelNow`, the claim),
// and the agent's configured model stays first in the turn's fallback chain: it offers
// `prefer`, never `only`.

const label = (id: string) => ({ i18n: `localAi.classes.${id}.label` });
const description = (id: string) => ({ i18n: `localAi.classes.${id}.description` });

// The modes of work whose configured model always remains its fallback.
const PREFER_ONLY: readonly LocalAiMode[] = ['off', 'prefer'];

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
    // Hermes' auxiliary calls (runner local-ai.ts): the agent's main model is their fallback.
    wired: true,
    modes: PREFER_ONLY,
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
    // The update center's digest runs (updates/digest.ts): an agent's text-only turn, which
    // thinks on the local model. Version 2: the eval thinks too, with room for it (it failed
    // at 800 tokens with thinking, 0.25, and passed without, 1.00).
    thinking: 'low',
    inMasterDefault: true,
    wired: true,
    modes: PREFER_ONLY,
    evaluate: evaluateSummaries,
    evalVersion: 2,
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
    // What Helena classifies today goes through the decisions service (`decide()`): the mail
    // classifier, the model router, receipts and the workflow step "Entscheidung", on the
    // class `decisions` (modules/decisions/local-ai-class.ts). Nothing is left for this class
    // (proposal: retire it in favour of `decisions`, local-ai-platform.md §7.1).
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
    id: 'voice-reply',
    label: label('voice-reply'),
    description: description('voice-reply'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'interactive',
    // A spoken question is answered by a small fast model where the conversation answers it,
    // and handed to the agent otherwise (modules/voice/reply.ts, voice-2.md §4). It only talks:
    // no tools but the hand-over, no data. Its eval requires every hand-over case.
    thinking: 'off',
    inMasterDefault: false,
    wired: true,
    modes: PREFER_ONLY,
    evaluate: evaluateVoiceReply,
    threshold: VOICE_REPLY_THRESHOLD,
  },
  {
    id: 'routines',
    label: label('routines'),
    description: description('routines'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'background',
    // The run a routine's fire starts (engine delegate step → the task's delegation run): a
    // full agent turn with all of the agent's tools. Version 2: the eval offers a toolset of
    // the agent's size (22 tools) instead of four.
    thinking: 'low',
    // Real routines act: never switched on by the master switch (local-ai-platform.md §7.1).
    inMasterDefault: false,
    wired: true,
    modes: PREFER_ONLY,
    evaluate: evaluateRoutines,
    evalVersion: 2,
    threshold: 0.9,
  },
  {
    id: 'reflection',
    label: label('reflection'),
    description: description('reflection'),
    unit: 'gpu',
    capability: 'chat',
    priority: 'background',
    // The turn after a run in which the agent keeps what it learned, with its memory and
    // skill tools (agents/runner/reflection.ts), for sessions small enough to load quickly.
    // Version 2: its own eval (the right fact kept, nothing kept of a trivial task, never a
    // secret) instead of the summaries'. Version 3: without thinking, live and in the eval
    // (with it, 0.00 on Qwen3.6: every case thought past its token limit, p50 68 s); the run
    // starts on the server's provider without thinking (runner local-ai.ts).
    thinking: 'off',
    // It writes the agent's memory and skills, which every later run reads.
    inMasterDefault: false,
    wired: true,
    modes: PREFER_ONLY,
    evaluate: evaluateReflection,
    evalVersion: 3,
    threshold: 0.85,
  },
  {
    id: 'coordinator-triage',
    label: label('coordinator-triage'),
    description: description('coordinator-triage'),
    unit: 'gpu',
    capability: 'tools',
    priority: 'background',
    // The coordinate stage of an agent team, first attempt only (engine agent-team.ts): a plan
    // the stage cannot use is planned again on the coordinator's configured model. Version 2:
    // its own eval over the stage's real prompt and parser instead of the routines'.
    thinking: 'low',
    inMasterDefault: false,
    wired: true,
    modes: PREFER_ONLY,
    evaluate: evaluateCoordinatorTriage,
    evalVersion: 2,
    threshold: 0.8,
  },
];
