import type { DecisionBackendType, DecisionClass, HelenaPlugin } from '@helena/sdk';
import { registries } from '#shared/helena';
import { GENERIC_EVAL } from './evals/generic';
import { MAIL_EVAL } from './evals/mail';
import { RECEIPT_EVAL } from './evals/receipts';
import { ROUTER_EVAL } from './evals/router';
import { BROWSER_EVAL } from './evals/browser';
import { DECISIONS_LOCAL_AI_CLASS } from './local-ai-class';
import { ROUTINE_GATE_EVAL } from './evals/routine-gate';
import { HEARTBEAT_PRECHECK_EVAL } from './evals/heartbeat-precheck';
import { TASK_TRIAGE_EVAL } from './evals/task-triage';
import { AGENT_ROUTING_EVAL } from './evals/agent-routing';

// Helena's own decision classes and the backends the decisions service adds to the browser
// task's (docs/helena-decisions/decisions.md §2, §4), registered as the internal plugin
// `helena.decisions` at the framework's extension points (@helena/sdk decisionClasses,
// decisionBackends), the way a plugin registers its own.

export const DECISIONS_PLUGIN_ID = 'helena.decisions';

export const ROUTER_CLASS = 'helena.model-router';
export const MAIL_CLASS = 'helena.mail';
export const RECEIPTS_CLASS = 'helena.receipts';
export const GENERAL_CLASS = 'helena.general';
export const BROWSER_CLASS = 'helena.browser';
export const ROUTINE_GATE_CLASS = 'helena.routine.gate';
export const HEARTBEAT_PRECHECK_CLASS = 'routines.precheck';
export const TASK_TRIAGE_CLASS = 'tasks.triage';
export const AGENT_ROUTING_CLASS = 'agents.routing';

export const BUILTIN_DECISION_CLASSES: DecisionClass[] = [
  {
    id: HEARTBEAT_PRECHECK_CLASS,
    label: { en: 'Heartbeat precheck', de: 'Heartbeat-Vorprüfung' },
    description: {
      en: 'Checks one borderline assigned task.',
      de: 'Prüft eine einzelne Grenzfallaufgabe.',
    },
    input: { store: 'never', cloud: 'never' },
    defaults: { threshold: 0.8, timeoutMs: 5000 },
    eval: HEARTBEAT_PRECHECK_EVAL,
  },
  {
    id: TASK_TRIAGE_CLASS,
    label: { en: 'Task triage', de: 'Aufgaben-Einordnung' },
    description: {
      en: 'Suggests responsibility and priority.',
      de: 'Schlägt Zuständigkeit und Priorität vor.',
    },
    input: { store: 'never', cloud: 'never' },
    defaults: { threshold: 0.85, timeoutMs: 5000 },
    eval: TASK_TRIAGE_EVAL,
  },
  {
    id: AGENT_ROUTING_CLASS,
    label: { en: 'Agent routing', de: 'Agenten-Routing' },
    description: {
      en: 'Selects an eligible agent for a task.',
      de: 'Wählt einen geeigneten Agenten für eine Aufgabe.',
    },
    input: { store: 'never', cloud: 'allowed' },
    defaults: { threshold: 0.85, timeoutMs: 5000 },
    eval: AGENT_ROUTING_EVAL,
  },
  {
    id: ROUTINE_GATE_CLASS,
    label: { en: 'Routine preflight', de: 'Routinen-Vorprüfung' },
    description: {
      en: 'Decides borderline routine runs locally.',
      de: 'Entscheidet Grenzfälle bei Routinen lokal.',
    },
    input: { store: 'never', cloud: 'never' },
    defaults: { threshold: 0.8, timeoutMs: 5000 },
    eval: ROUTINE_GATE_EVAL,
  },
  {
    id: BROWSER_CLASS,
    label: { i18n: 'decisions.classes.browser.label' },
    description: { i18n: 'decisions.classes.browser.description' },
    input: { store: 'never', cloud: 'allowed' },
    defaults: { threshold: 0.95, timeoutMs: 3000 },
    eval: BROWSER_EVAL,
  },
  {
    id: ROUTER_CLASS,
    label: { i18n: 'decisions.classes.router.label' },
    description: { i18n: 'decisions.classes.router.description' },
    // The request text of a run or chat answer, or of the owner's Claude Code prompt.
    input: { store: 'optional', cloud: 'allowed' },
    // Thresholds from the evals (decisions.md §8): the router's tier question reaches 96 %
    // precision at 0.8 on the local AI; a wrong downgrade costs more than a kept model.
    defaults: { threshold: 0.8, timeoutMs: 5000 },
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
    // 100 % precision at 0.95 on the local AI; auto-matching also needs the rules to agree.
    defaults: { threshold: 0.95, timeoutMs: 8000 },
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
// The local AI's workhorse, which passed every class's eval by logit readout on 2026-09-25
// (decisions.md §8); Lemonade's name for it.
export const LOCAL_DECISION_MODEL = 'Qwen3.6-35B-A3B-MTP-GGUF';

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
