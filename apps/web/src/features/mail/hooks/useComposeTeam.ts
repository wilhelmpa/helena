import { useProjectsQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';

// The team a new mail is written in: the project's, or in Home the first team.
export function useComposeTeam(projectKey: string | null): number | null {
  const teams = useTeamsQuery();
  const projects = useProjectsQuery();
  if (projectKey) return projects.data?.find((item) => item.key === projectKey)?.teamId ?? null;
  return teams.data?.[0]?.id ?? null;
}
