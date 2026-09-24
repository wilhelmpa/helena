// Helena's Autopilot levels: how independently the agents of a project act.
//   0 Vorschlagen          the agent only reads and proposes; every change needs approval
//   1 Mit Freigabe          it changes Helena and its workspace; everything consequential
//                           (send, delete, pay, publish, risky commands, credentials) needs
//                           approval. This is how Helena behaved before the Autopilot.
//   2 Handeln & berichten   it also deletes and runs risky commands inside its workspace and
//                           reports what it did; outward and outside actions need approval
//   3 Autonom im Budget     no approvals except the hard blocks (pay, delete outside the
//                           workspace, credentials) until a budget is used up
// The policy set in policies.ts is what decides; this file only names the levels and says
// which one applies.
export const AUTOPILOT_LEVELS = [0, 1, 2, 3] as const;

export type AutopilotLevel = (typeof AUTOPILOT_LEVELS)[number];

export const DEFAULT_AUTOPILOT_LEVEL: AutopilotLevel = 1;

export const AUTOPILOT_LEVEL_KEYS: Record<AutopilotLevel, string> = {
  0: 'propose',
  1: 'approve',
  2: 'actReport',
  3: 'autonomous',
};

export function isAutopilotLevel(value: unknown): value is AutopilotLevel {
  return typeof value === 'number' && (AUTOPILOT_LEVELS as readonly number[]).includes(value);
}

// Where the level that applies comes from:
//   project       the project's level (the agent has none of its own, or a laxer one)
//   agent         the agent's own, stricter level
//   agent-raised  the agent's own level above the project's, which the owner allowed
//   default       no project and no level of the agent's own
export type LevelSource = 'project' | 'agent' | 'agent-raised' | 'default';

export interface EffectiveLevel {
  level: AutopilotLevel;
  source: LevelSource;
}

// The level that applies to an agent's work in a project: the stricter of the project's
// and the agent's own, unless the owner explicitly let the agent act more independently
// than the project (`agentRaise`). Work outside a project (a Home chat) takes the agent's
// own level, or the default.
export function effectiveLevel(input: {
  projectLevel: number | null;
  agentLevel: number | null;
  agentRaise?: boolean;
}): EffectiveLevel {
  const project = isAutopilotLevel(input.projectLevel) ? input.projectLevel : null;
  const agent = isAutopilotLevel(input.agentLevel) ? input.agentLevel : null;
  if (project === null) {
    return agent === null
      ? { level: DEFAULT_AUTOPILOT_LEVEL, source: 'default' }
      : { level: agent, source: 'agent' };
  }
  if (agent === null || agent === project) return { level: project, source: 'project' };
  if (agent < project) return { level: agent, source: 'agent' };
  return input.agentRaise
    ? { level: agent, source: 'agent-raised' }
    : { level: project, source: 'project' };
}
