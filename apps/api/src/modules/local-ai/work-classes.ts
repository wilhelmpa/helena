// The kinds of work Helena hands to local AI as an agent's turn (task-classes.ts), by the id
// a producer stores on the run (agent_run.work_class) or asks for (a reflection). The claim
// decides where it runs (local-ai/service.ts classModelNow); the producers only say what the
// work is. Kept apart from the classes so a producer does not load their evals.
export const WORK_CLASS = {
  // The update center's digest run (updates/digest.ts).
  summaries: 'summaries',
  // The run a routine's fire starts (engine/builtin/steps/delegate.ts).
  routines: 'routines',
  // An agent team's first coordinate stage (engine/builtin/steps/agent-team.ts).
  coordinatorTriage: 'coordinator-triage',
  // The turn after a run (agents/runner/service.ts requestReflection).
  reflection: 'reflection',
} as const;

export type WorkClass = (typeof WORK_CLASS)[keyof typeof WORK_CLASS];
