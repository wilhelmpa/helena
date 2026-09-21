export function resolveInboxTeamId(input: {
  projectKey: string | null;
  projectTeamId?: number;
  currentTeamId: number | null;
  availableTeamIds: number[];
}): number | null {
  if (input.projectKey) return input.projectTeamId ?? null;
  if (
    input.currentTeamId != null &&
    input.availableTeamIds.some((teamId) => teamId === input.currentTeamId)
  )
    return input.currentTeamId;
  return input.availableTeamIds[0] ?? null;
}
