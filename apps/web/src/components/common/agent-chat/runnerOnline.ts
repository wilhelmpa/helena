// A runner is considered online while it keeps polling; the reference runner polls
// every few seconds, so a gap this long means it is gone rather than between polls.
const ONLINE_WINDOW_MS = 90_000;

export function isRunnerOnline(
  agent: { lastSeenAt: string | null; runtimeState?: { detail: string | null } } | null,
): boolean {
  if (agent?.runtimeState?.detail === 'Agent no longer belongs to a project') return false;
  const lastSeen = agent?.lastSeenAt ?? null;
  return lastSeen != null && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}
