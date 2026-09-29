import { chatPath, homeChatPath } from '@/utils/paths';

// Where a chat opens: the project's chat page, or Home's (which lists every chat). Without
// a thread it is a new chat with the agent, which the page must not swap for the saved one.
export function chatHref(
  projectKey: string | null,
  target: { agentId?: number | null; threadId?: string | null } = {},
): string {
  const query = { agent: target.agentId ?? null, thread: target.threadId ?? null };
  const href = projectKey ? chatPath(projectKey, query) : homeChatPath(query);
  if (target.threadId) return href;
  return `${href}${href.includes('?') ? '&' : '?'}new=1`;
}
