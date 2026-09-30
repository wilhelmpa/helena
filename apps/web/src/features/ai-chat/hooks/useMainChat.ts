'use client';

import { chatHref } from '../utils/chatHref';
import { mainAgentOf, mainChatLocation } from '../utils/contextAgents';
import { useActiveChat } from './useActiveChat';
import { useChatWorkspaceScope } from './useChatWorkspaceScope';

// The chat of a place with its main agent (owner, O99/O105): the one function the logo and the
// orb share. `agent` is the place's main agent (its coordinator, in Home Ava) and `location`
// the chat that opens with it — see mainChatLocation.
export function useMainChat(projectKey: string | null) {
  const scope = useChatWorkspaceScope(projectKey);
  const active = useActiveChat(projectKey ? `project:${projectKey}` : 'home');
  const agent = mainAgentOf(scope.agents);
  const location = agent ? mainChatLocation(agent.id, active.location) : null;
  return { agent, location };
}

// Where the logo leads (owner, O99): Home's chat with Ava, from every page and every project.
export function useLogoHref(): string {
  const { location } = useMainChat(null);
  return location ? chatHref(null, location) : '/';
}
