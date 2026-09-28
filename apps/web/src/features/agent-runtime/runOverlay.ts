// Where the run overlay stands: `?agentRun=<agentId>.<runId>` on any page, set without
// navigation (the page behind never reloads).
export const RUN_PARAM = 'agentRun';
export const RUN_OVERLAY_OPEN = 'helena:open-run';

export function parseRunParam(value: string | null): { agentId: number; runId: number } | null {
  const match = value?.match(/^(\d+)\.(\d+)$/);
  return match ? { agentId: Number(match[1]), runId: Number(match[2]) } : null;
}

// Opens one run of an agent in the overlay over the current page.
export function openRun(agentId: number, runId: number) {
  window.dispatchEvent(new CustomEvent(RUN_OVERLAY_OPEN, { detail: { agentId, runId } }));
}
