import type { AiAgent } from '@/lib/api/endpoints/agents';

// What a row of the agent pool says besides the name: the projects the agent works in (by
// key, in order) and its model in short ("helena-local/Qwen3.8-27B" → "Qwen3.8-27B"),
// null for the runtime's own default.
export function poolRowText(agent: Pick<AiAgent, 'projects' | 'model'>): {
  projects: string[];
  model: string | null;
} {
  const projects = [...agent.projects].map((project) => project.key).sort();
  const model = agent.model ? (agent.model.split('/').at(-1) ?? agent.model) : null;
  return { projects, model };
}

// Agents first, then the templates, each by name (the pool's two groups).
export function poolGroups<T extends Pick<AiAgent, 'template' | 'name'>>(
  agents: T[],
): { agents: T[]; templates: T[] } {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  return {
    agents: agents.filter((agent) => !agent.template).sort(byName),
    templates: agents.filter((agent) => agent.template).sort(byName),
  };
}
