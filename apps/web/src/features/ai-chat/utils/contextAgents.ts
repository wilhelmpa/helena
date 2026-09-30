import type { AiAgent } from '@/lib/api/endpoints/agents';

type AgentLike = Pick<AiAgent, 'id' | 'username' | 'agentRole' | 'projectScope' | 'projects'>;

// The agents of a chat picker in the order the place calls for (owner, 28.09., O41): in a
// project its coordinator first (the agent the project's tools open on, `coordinator`), else
// the first agent working in it; Helena right after, so she is always one pick away; then
// everyone else in the list's order. Outside a project Helena leads.
export function contextAgents<T extends AgentLike>(
  agents: T[],
  projectKey: string | null,
  coordinator: string,
): T[] {
  const home = agents.find((agent) => agent.agentRole === 'home');
  const lead = projectKey
    ? (agents.find((agent) => coordinator && agent.username === coordinator) ??
      agents.find(
        (agent) =>
          agent.agentRole !== 'home' &&
          agent.projectScope !== 'all' &&
          agent.projects.some((project) => project.key === projectKey),
      ))
    : home;
  const first = [lead, home].filter(
    (agent, index, list): agent is T => agent != null && list.indexOf(agent) === index,
  );
  return [...first, ...agents.filter((agent) => !first.includes(agent))];
}

// The scope a new chat with an agent takes from a Home (team) workspace: an agent that works
// in exactly one project answers there — with that project's context and rights — instead of
// as a projectless Home chat. Helena and agents of several projects stay in the Home scope.
export function newChatScopeKey(scopeKey: string, agent: AgentLike | null): string {
  if (!scopeKey.startsWith('team:') || !agent || agent.agentRole === 'home') return scopeKey;
  if (agent.projectScope === 'all' || agent.projects.length !== 1) return scopeKey;
  return agent.projects[0]!.key;
}

// The main agent of a place (owner, O105): the one the logo and the orb open the chat with —
// in a project its coordinator, in Home Ava (the home agent). It is the first of the list
// `contextAgents` orders (which `useChatWorkspaceScope` returns), so the pickers, the logo and
// the orb can never disagree about it.
export function mainAgentOf<T>(agents: T[]): T | null {
  return agents[0] ?? null;
}

// The chat that opens with the main agent: the conversation last open with it, if that is
// the one remembered for the place — so closing and reopening the orb keeps the chat — and
// otherwise a new chat with it, never another agent's chat (the agent is switched in the
// composer, not before the chat opens).
export function mainChatLocation(
  mainAgentId: number,
  remembered: { agentId: number | null; threadId: string | null },
): { agentId: number; threadId: string | null } {
  return remembered.agentId === mainAgentId
    ? { agentId: mainAgentId, threadId: remembered.threadId }
    : { agentId: mainAgentId, threadId: null };
}
