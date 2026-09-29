export function runnerDisplayName(env: Record<string, string | undefined> = process.env): string {
  return env.VOLITION_DISPLAY_NAME ?? 'Helena';
}
