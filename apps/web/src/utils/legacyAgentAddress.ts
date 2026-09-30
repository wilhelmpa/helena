// An old address of an agent - a bookmark, a chat command's `/agents?agent=7&tab=runs&run=1` -
// opens the agent in the one overlay on the page it lands on: the overlay reads `agentSheet`,
// `agentTab` and `agentRunId` (features/settings/AgentDialog.tsx). The redirect from /agents
// renames the old parameters, so the agent stays open (and after a reload too) instead of
// being lost on the way (battle test F11).
const RENAMED: Record<string, string> = {
  agent: 'agentSheet',
  tab: 'agentTab',
  run: 'agentRunId',
};

export function agentAddressQuery(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value])
      query.append(RENAMED[key] ?? key, item);
  return query.toString();
}
