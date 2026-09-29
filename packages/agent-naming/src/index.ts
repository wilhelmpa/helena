const PROJECT_COORDINATOR = /^[a-z0-9][a-z0-9_-]*-koordinator$/;

// A project coordinator is a real external agent (ai_agent row), not a
// deployment-side record. The deterministic, reserved handle makes it unique per
// project key, which is instance-wide unique. VERV is spelled out as "verve" because
// the bare key reads oddly as a handle; every other key is just lowercased.
export function projectCoordinatorUsername(projectKey: string): string {
  const slug = projectKey === 'VERV' ? 'verve' : projectKey.toLowerCase();
  return `${slug}-koordinator`;
}

export function isProjectCoordinatorUsername(username: string): boolean {
  return PROJECT_COORDINATOR.test(username);
}
