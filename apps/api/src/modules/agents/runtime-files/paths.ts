export type AgentRuntimeFileKind = 'instructions';

// Plan manages the agent's identity and instructions. Memory belongs to Hermes, which
// writes it during every session, and a project's AGENTS.md belongs to the project.
export const INSTRUCTIONS_FILE_PATTERN =
  '^(?:SOUL\\.md|instructions/(?:[A-Za-z0-9][A-Za-z0-9._-]*/){0,6}[A-Za-z0-9][A-Za-z0-9._-]*\\.md)$';

const instructionsPattern = new RegExp(INSTRUCTIONS_FILE_PATTERN);

export function runtimeFileKind(path: string): AgentRuntimeFileKind | null {
  return instructionsPattern.test(path) ? 'instructions' : null;
}
