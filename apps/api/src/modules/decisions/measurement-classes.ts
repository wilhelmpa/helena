import { TRADING_DECISION_CLASSES } from '@helena/trading';
import { BUILTIN_DECISION_CLASSES } from './builtin-classes';

const names: Record<string, string> = {
  'helena.model-router': 'router',
  'helena.mail': 'mail',
  'helena.receipts': 'receipts',
  'helena.general': 'general',
  'helena.browser': 'browser',
  'tasks.triage': 'task-triage',
  'agents.routing': 'agent-routing',
  'helena.routine.gate': 'routine-gate',
  'routines.precheck': 'heartbeat-precheck',
  'helena.trading.news': 'trading-news',
  'helena.trading.rules': 'trading-rules',
  'helena.trading.routing': 'trading-routing',
};

export const MEASUREMENT_CLASSES = [...BUILTIN_DECISION_CLASSES, ...TRADING_DECISION_CLASSES]
  .filter((definition) => names[definition.id] !== undefined)
  .map((definition) => ({ name: names[definition.id]!, definition }));
