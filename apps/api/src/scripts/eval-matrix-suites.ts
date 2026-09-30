import { BUILTIN_TASK_CLASSES } from '../modules/local-ai/task-classes';
import type { ModelRole } from '../modules/model-schemas/templates';
import { DECISION_EVAL_SETS } from './decisions-eval';

export type MatrixSuite = {
  id: string;
  kind: 'chat' | 'decision' | 'browser';
  source: string;
  placement: string;
  threshold: number;
  confidenceThreshold?: number;
  privateData?: boolean;
  jevControl?: boolean;
};
const chat = (id: string): MatrixSuite => {
  const entry = BUILTIN_TASK_CLASSES.find((item) => item.id === id);
  if (!entry?.evaluate) throw new Error(`Missing chat eval ${id}`);
  return { id, kind: 'chat', source: id, placement: id, threshold: entry.threshold ?? 0.8 };
};
const decision = (source: string, placement: string, privateData = false): MatrixSuite => {
  const entry = DECISION_EVAL_SETS[source];
  if (!entry) throw new Error(`Missing decision eval ${source}`);
  return {
    id: source,
    kind: 'decision',
    source,
    placement,
    threshold: entry.set.minPrecision ?? 0.9,
    confidenceThreshold: entry.threshold,
    privateData,
  };
};
const tools = [chat('routines'), decision('tool-selection', 'tool-selection')];
const coordination = [
  chat('triage'),
  chat('coordinator-triage'),
  ...tools,
  decision('agent-routing', 'agents.routing'),
];
const coding = [chat('agentic-coding'), ...tools];
const writing = [chat('deutsch-texte'), chat('voice-reply')];
const research = [chat('summaries'), chat('reflection')];
const finance = [
  decision('mail', 'helena.mail', true),
  decision('receipts', 'helena.receipts', true),
  decision('trading-rules', 'helena.trading.rules', true),
  decision('trading-routing', 'helena.trading.routing', true),
  { ...decision('general', 'volition.private', true), id: 'privat' },
  decision('paper-precheck', 'paper-precheck', true),
];
export const ROLE_SUITES: Record<ModelRole, readonly MatrixSuite[]> = {
  home: coordination,
  coordinator: coordination,
  coder: coding,
  reviewer: coding,
  devops: coding,
  browser: [
    {
      id: 'browser-direct',
      kind: 'browser',
      source: 'local',
      placement: 'browser-direct',
      threshold: 1,
    },
    {
      id: 'browser-jev',
      kind: 'browser',
      source: 'local',
      placement: 'browser-jev',
      threshold: 1,
      jevControl: true,
    },
  ],
  content: writing,
  support: writing,
  assistant: writing,
  research,
  planning: research,
  finance,
  trading: finance,
  general: [
    chat('triage'),
    chat('routines'),
    chat('hermes-helpers'),
    chat('summaries'),
    chat('reflection'),
    chat('voice-reply'),
    chat('coordinator-triage'),
    decision('general', 'helena.general'),
    decision('router', 'helena.model-router'),
    decision('routine-gate', 'helena.routine.gate'),
    decision('heartbeat-precheck', 'routines.precheck'),
  ],
};
