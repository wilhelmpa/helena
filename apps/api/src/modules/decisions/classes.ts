import type { DecisionBackendType, DecisionClass, HelenaPlugin } from '@helena/sdk';
import { registries } from '#shared/helena';
import { GENERIC_EVAL } from './evals/generic';
import { MAIL_EVAL } from './evals/mail';
import { RECEIPT_EVAL } from './evals/receipts';
import { ROUTER_EVAL } from './evals/router';

// Helena's own decision classes and the backends the decisions service adds to the browser
// task's (docs/helena-decisions/decisions.md §2, §4), registered as the internal plugin
// `helena.decisions` at the framework's extension points (@helena/sdk decisionClasses,
// decisionBackends), the way a plugin registers its own.

export const DECISIONS_PLUGIN_ID = 'helena.decisions';

export const ROUTER_CLASS = 'helena.model-router';
export const MAIL_CLASS = 'helena.mail';
export const RECEIPTS_CLASS = 'helena.receipts';
export const GENERAL_CLASS = 'helena.general';

export const BUILTIN_DECISION_CLASSES: DecisionClass[] = [
  {
    id: ROUTER_CLASS,
    label: { i18n: 'decisions.classes.router.label' },
    description: { i18n: 'decisions.classes.router.description' },
    // The request text of a run or chat answer, or of the owner's Claude Code prompt.
    input: { store: 'optional', cloud: 'allowed' },
    defaults: { threshold: 0.6, timeoutMs: 5000 },
    eval: ROUTER_EVAL,
  },
  {
    id: MAIL_CLASS,
    label: { i18n: 'decisions.classes.mail.label' },
    description: { i18n: 'decisions.classes.mail.description' },
    input: { store: 'optional', cloud: 'allowed' },
    defaults: { threshold: 0.7, timeoutMs: 8000 },
    eval: MAIL_EVAL,
  },
  {
    id: RECEIPTS_CLASS,
    label: { i18n: 'decisions.classes.receipts.label' },
    description: { i18n: 'decisions.classes.receipts.description' },
    input: { store: 'optional', cloud: 'allowed' },
    defaults: { threshold: 0.85, timeoutMs: 8000 },
    eval: RECEIPT_EVAL,
  },
  {
    id: GENERAL_CLASS,
    label: { i18n: 'decisions.classes.general.label' },
    description: { i18n: 'decisions.classes.general.description' },
    input: { store: 'optional', cloud: 'allowed' },
    defaults: { threshold: 0.7, timeoutMs: 5000 },
    eval: GENERIC_EVAL,
  },
];

// Two more kinds of decision backend, over any OpenAI-compatible server (llama.cpp's
// llama-server, Lemonade): the "local logit" readout of a small language model, and a JSON
// answer of any chat model (docs/helena-decisions/decisions.md §3.2). Both answer the same
// System One questions as TypeSafe's Jev and Laya, so the browser's fast path can use them too.
export const LOCAL_AI_URL = 'http://127.0.0.1:13305/api/v1';

export const DECISIONS_BACKENDS: DecisionBackendType[] = [
  {
    id: 'local-logit',
    label: {
      en: 'Local language model (logit readout)',
      de: 'Lokales Sprachmodell (Logit-Auswertung)',
    },
    location: 'local',
    defaultBaseUrl: null,
    defaultModel: 'Qwen3.5-4B-GGUF',
    presets: [
      {
        id: 'local-ai',
        label: {
          en: 'Local AI on this server (logit readout)',
          de: 'Lokale KI auf diesem Server (Logit-Auswertung)',
        },
        baseUrl: LOCAL_AI_URL,
        model: 'Qwen3.5-4B-GGUF',
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
    defaultModel: 'Qwen3.5-4B-GGUF',
    presets: [
      {
        id: 'local-ai',
        label: {
          en: 'Local AI on this server (JSON answer)',
          de: 'Lokale KI auf diesem Server (JSON-Antwort)',
        },
        baseUrl: LOCAL_AI_URL,
        model: 'Qwen3.5-4B-GGUF',
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
