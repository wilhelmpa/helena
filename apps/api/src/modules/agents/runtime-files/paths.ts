export type AgentRuntimeFileKind = 'instructions' | 'memory';

export const INSTRUCTIONS_FILE_PATTERN =
  '^(?:AGENTS\\.md|SOUL\\.md|instructions/(?:[A-Za-z0-9][A-Za-z0-9._-]*/){0,6}[A-Za-z0-9][A-Za-z0-9._-]*\\.md)$';
export const MEMORY_FILE_PATTERN =
  '^(?:MEMORY\\.md|memory/(?:[A-Za-z0-9][A-Za-z0-9._-]*/){0,6}[A-Za-z0-9][A-Za-z0-9._-]*\\.md)$';

const instructionsPattern = new RegExp(INSTRUCTIONS_FILE_PATTERN);
const memoryPattern = new RegExp(MEMORY_FILE_PATTERN);

export function runtimeFileKind(path: string): AgentRuntimeFileKind | null {
  if (instructionsPattern.test(path)) return 'instructions';
  if (memoryPattern.test(path)) return 'memory';
  return null;
}
