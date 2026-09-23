// The one place the "hermes-<project-key>-coordinator" convention is defined. Both
// apps/api (which creates the coordinator agent with this handle,
// modules/projects/service.ts) and apps/web (which uses it to preselect the right
// agent for a project's chat, utils/workspaceTools.ts) used to implement this
// independently — a change to the convention (the prefix, or the VERV special case)
// had to be made in both places in lockstep, with nothing to catch a mismatch. This
// package is the single source of truth; both apps depend on it instead.

const HERMES_PROJECT_COORDINATOR = /^hermes-[a-z0-9_-]+-coordinator$/;

// A project coordinator is a real external agent (ai_agent row), not a
// deployment-side record. The deterministic, reserved handle makes it unique per
// project key, which is instance-wide unique. VERV is spelled out as "verve" because
// the bare key reads oddly as a handle; every other key is just lowercased.
export function hermesProjectCoordinatorUsername(projectKey: string): string {
  const slug = projectKey === 'VERV' ? 'verve' : projectKey.toLowerCase();
  return `hermes-${slug}-coordinator`;
}

export function isHermesProjectCoordinatorUsername(username: string): boolean {
  return HERMES_PROJECT_COORDINATOR.test(username);
}
