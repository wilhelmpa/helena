import { aiAgent, db } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { MAIL_CLASS } from '#modules/decisions/classes';
import { useClassConfigChecker } from '#modules/decisions/settings';

// What the mail classifier does with its answers (docs/helena-decisions/decisions.md §5), the
// class's own settings. Every action that writes is off or a suggestion until the owner
// chooses "automatisch": a suggestion is a button in the mail's classification that the owner
// presses (that is the approval), automatic acts at once.
//
// - project: suggest the project (the thread keeps its place until the owner moves it), or move
//   a Home thread into it at once. A thread already in a project is only ever suggested.
// - task: create a task in the thread's project when the mail asks for something to be done.
// - agent: create that task assigned to an agent, so the agent works on it.
// - receipts: take the PDF/XML attachments of an invoice mail as receipts of the project
//   (Finanzen → Belege); internal and reversible, so it may run automatically.

export type ActionMode = 'off' | 'suggest' | 'auto';

export interface MailTriageConfig {
  project: 'off' | 'suggest' | 'auto';
  task: ActionMode;
  agentId: number | null;
  agent: ActionMode;
  receipts: 'off' | 'auto';
  // Only these accounts; empty for all of the team's.
  accountIds: number[];
  // Mail that arrived before this is not classified (set when the class is first saved).
  since: string | null;
}

export const DEFAULT_CONFIG: MailTriageConfig = {
  project: 'suggest',
  task: 'suggest',
  agentId: null,
  agent: 'off',
  receipts: 'off',
  accountIds: [],
  since: null,
};

function mode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function mailTriageConfig(raw: Record<string, unknown>): MailTriageConfig {
  return {
    project: mode(raw.project, ['off', 'suggest', 'auto'] as const, DEFAULT_CONFIG.project),
    task: mode(raw.task, ['off', 'suggest', 'auto'] as const, DEFAULT_CONFIG.task),
    agentId: typeof raw.agentId === 'number' && raw.agentId > 0 ? raw.agentId : null,
    agent: mode(raw.agent, ['off', 'suggest', 'auto'] as const, DEFAULT_CONFIG.agent),
    receipts: mode(raw.receipts, ['off', 'auto'] as const, DEFAULT_CONFIG.receipts),
    accountIds: Array.isArray(raw.accountIds)
      ? raw.accountIds.filter((id): id is number => typeof id === 'number' && id > 0).slice(0, 50)
      : [],
    since: typeof raw.since === 'string' && !Number.isNaN(Date.parse(raw.since)) ? raw.since : null,
  };
}

useClassConfigChecker(MAIL_CLASS, async (raw, teamId) => {
  const config = mailTriageConfig(raw);
  if (config.agentId) {
    const [agent] = await db
      .select({ id: aiAgent.id })
      .from(aiAgent)
      .where(and(eq(aiAgent.id, config.agentId), eq(aiAgent.teamId, teamId)));
    if (!agent) throw new HttpError(400, 'The agent is not one of this team.');
  }
  if (config.agent !== 'off' && !config.agentId)
    throw new HttpError(400, 'Choose the agent mail is handed to.');
  // Classification starts with the mail that arrives from now on, not the whole mailbox.
  return { ...config, since: config.since ?? new Date().toISOString() };
});
