import type { DecisionBackendType, DecisionClass, HelenaPlugin } from '@helena/sdk';
import { registries } from '#shared/helena';
import { DECISIONS_LOCAL_AI_CLASS } from './local-ai-class';
import { BUILTIN_DECISION_CLASSES } from './builtin-classes';

// Helena's own decision classes and the backends the decisions service adds to the browser
// task's (docs/helena-decisions/decisions.md §2, §4), registered as the internal plugin
// `helena.decisions` at the framework's extension points (@helena/sdk decisionClasses,
// decisionBackends), the way a plugin registers its own.

export const DECISIONS_PLUGIN_ID = 'helena.decisions';

export * from './builtin-classes';

export function localAiClassForDecision(_classId: string): 'decisions' {
  return 'decisions';
}

// Two more kinds of decision backend, over any OpenAI-compatible server (llama.cpp's
// llama-server, Lemonade): the "local logit" readout of a small language model, and a JSON
// answer of any chat model (docs/helena-decisions/decisions.md §3.2). Both answer the same
// System One questions as TypeSafe's Jev, so the browser's fast path can use them too.
export const LOCAL_AI_URL = 'http://127.0.0.1:8731/v1';
export const LOCAL_DECISION_MODEL = 'halogen-qwen3.8-flash-next';

export const DECISIONS_BACKENDS: DecisionBackendType[] = [
  {
    id: 'local-logit',
    label: {
      en: 'Local language model (logit readout)',
      de: 'Lokales Sprachmodell (Logit-Auswertung)',
    },
    location: 'local',
    defaultBaseUrl: null,
    defaultModel: LOCAL_DECISION_MODEL,
    presets: [
      {
        id: 'local-ai',
        label: {
          en: 'Local AI on this server (logit readout)',
          de: 'Lokale KI auf diesem Server (Logit-Auswertung)',
        },
        baseUrl: LOCAL_AI_URL,
        model: LOCAL_DECISION_MODEL,
        allowPrivateAddress: true,
        keySource: 'local-ai',
        modelServer: 'local',
      },
    ],
    policy: 'jev',
    protocol: 'openai-logprobs',
    keyRequired: false,
    providerName: 'local',
  },
  {
    id: 'llm-json',
    label: {
      en: 'Language model (JSON answer)',
      de: 'Sprachmodell (JSON-Antwort)',
    },
    location: 'local',
    defaultBaseUrl: null,
    defaultModel: LOCAL_DECISION_MODEL,
    presets: [
      {
        id: 'local-ai',
        label: {
          en: 'Local AI on this server (JSON answer)',
          de: 'Lokale KI auf diesem Server (JSON-Antwort)',
        },
        baseUrl: LOCAL_AI_URL,
        model: LOCAL_DECISION_MODEL,
        allowPrivateAddress: true,
        keySource: 'local-ai',
        modelServer: 'local',
      },
    ],
    policy: 'jev',
    protocol: 'openai-json',
    keyRequired: false,
    providerName: 'local',
  },
];

export const decisionsPlugin: HelenaPlugin = {
  register(ctx) {
    for (const backend of DECISIONS_BACKENDS) ctx.decisionBackends.register(backend);
    for (const decisionClass of BUILTIN_DECISION_CLASSES)
      ctx.decisionClasses.register(decisionClass);
    // Local AI answers the decisions only while Lokale KI routes this class (its master
    // switch, the class's mode, its model's eval).
    ctx.localAiTaskClasses.register(DECISIONS_LOCAL_AI_CLASS);
  },
};

export function decisionClass(id: string): DecisionClass | null {
  return (
    registries.decisionClasses.get(id) ??
    BUILTIN_DECISION_CLASSES.find((entry) => entry.id === id) ??
    null
  );
}

export function decisionClasses(): DecisionClass[] {
  const listed = registries.decisionClasses.list();
  return listed.length > 0 ? listed : BUILTIN_DECISION_CLASSES;
}
