import { activeGoalsForAgent } from '#modules/goals/service';
import { goalsSection } from '#modules/goals/scope';
import { projectGoalsForAgent } from '#modules/project-goals/service';
import type { AiAgentRow } from '../core/service';

// The goals an agent's work serves, as a SOUL.md section (docs/helena-decisions/
// agent-context.md §7): the active goals of its projects, of their departments and of the
// whole team; every active goal for the Home agent. A template works in no project and
// reads none.
export async function agentGoalsSection(agent: AiAgentRow): Promise<string> {
  if (agent.projects.length === 0 && agent.projectScope !== 'all') return '';
  return [goalsSection(await activeGoalsForAgent(agent)), await projectGoalsForAgent(agent)]
    .filter(Boolean)
    .join('\n\n');
}
