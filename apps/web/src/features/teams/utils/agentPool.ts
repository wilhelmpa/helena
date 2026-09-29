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

export type PoolShow = 'all' | 'agents' | 'templates';

// The pool list of the Team page (Auftrag 117): filtered by a search over name, handle,
// projects and model, by agents or templates, and — on a project's Team page — to the
// agents that work in the project (the templates stay, a project adds copies of them).
export function filterPool<
  T extends Pick<AiAgent, 'template' | 'name' | 'username' | 'model'> & {
    projects: { key: string; name: string }[];
  },
>(
  agents: T[],
  {
    search = '',
    show = 'all',
    projectKey = null,
  }: {
    search?: string;
    show?: PoolShow;
    projectKey?: string | null;
  },
): { agents: T[]; templates: T[] } {
  const query = search.trim().toLocaleLowerCase();
  const matches = (agent: T) =>
    !query ||
    [
      agent.name,
      agent.username,
      agent.model ?? '',
      ...agent.projects.flatMap((p) => [p.key, p.name]),
    ]
      .join('\u0000')
      .toLocaleLowerCase()
      .includes(query);
  const inProject = (agent: T) =>
    agent.template || projectKey == null || agent.projects.some((p) => p.key === projectKey);
  const groups = poolGroups(agents.filter((agent) => matches(agent) && inProject(agent)));
  return {
    agents: show === 'templates' ? [] : groups.agents,
    templates: show === 'agents' ? [] : groups.templates,
  };
}
