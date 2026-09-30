export function isMailTriageRoutine(title: string | null): boolean {
  return title?.startsWith('Mail-Triage · ') ?? false;
}
