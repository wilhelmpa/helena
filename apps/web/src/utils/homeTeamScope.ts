export function soleTeamId(teams: Array<{ id: number }> | undefined): number | null {
  return teams?.length === 1 ? teams[0]!.id : null;
}
