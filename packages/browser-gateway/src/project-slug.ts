// The same mapping apps/api/src/shared/agent-socket.ts (projectSlug/HOME_SLUG) and
// agent-egress use, duplicated here for the same reason domain.ts's normalizeHost is: this
// package runs in the browser router process, a different deployment unit from the API.
export const HOME_SLUG = 'home';

export function projectSlug(projectKey: string): string {
  return projectKey === 'VERV' ? 'verve' : projectKey.toLowerCase();
}
