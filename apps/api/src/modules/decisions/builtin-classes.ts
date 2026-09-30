import type { DecisionClass } from '@helena/sdk';
import { GENERIC_EVAL } from './evals/generic';
import { MAIL_EVAL } from './evals/mail';
import { RECEIPT_EVAL } from './evals/receipts';
import { ROUTER_EVAL } from './evals/router';
import { BROWSER_EVAL } from './evals/browser';
import { ROUTINE_GATE_EVAL } from './evals/routine-gate';
import { HEARTBEAT_PRECHECK_EVAL } from './evals/heartbeat-precheck';
import { TASK_TRIAGE_EVAL } from './evals/task-triage';
import { AGENT_ROUTING_EVAL } from './evals/agent-routing';
import { TOOL_SELECTION_CLASS } from './tool-selection-questions';
import { TOOL_SELECTION_EVAL } from './evals/tool-selection';
import { AVA_COMMAND_CLASS } from './ava-questions';
import { AVA_COMMAND_EVAL } from './evals/ava-befehle';

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
    id: AVA_COMMAND_CLASS,
    label: { en: 'Ava commands', de: 'Ava-Befehle' },
    input: { store: 'never', cloud: 'allowed' },
    defaults: { threshold: 0.98, timeoutMs: 1000 },
    eval: AVA_COMMAND_EVAL,
  },
  {
    id: TOOL_SELECTION_CLASS,
    label: { en: 'Tool selection', de: 'Werkzeug-Vorauswahl' },
    input: { store: 'never', cloud: 'allowed' },
    defaults: { threshold: 0.95, timeoutMs: 1000 },
    eval: TOOL_SELECTION_EVAL,
  },
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
    input: { store: 'never', cloud: 'allowed' },
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
