import { db, projectViewFolder } from '@repo/db';
import { asc, inArray } from 'drizzle-orm';

import type { AiAgentRow } from '../core/service';

export function projectAreasSection(
  projects: { key: string; areas: { name: string; folder: string }[] }[],
): string {
  const lines = projects
    .filter((project) => project.areas.length > 0)
    .map(
      (project) =>
        `- ${project.key}: ${project.areas.map((area) => `${area.name} (folder ${area.folder})`).join(', ')}`,
    );
  if (lines.length === 0) return '';
  return [
    '## Areas',
    'Each area of a project has a folder of its own, at the same relative path in the',
    "project workspace and in the project's vault folder (the Files page in Helena). A run",
    'for a task of an area starts in its folder of the project workspace; keep the files of',
    "that area's work there.",
    '',
    ...lines,
  ].join('\n');
}

// The areas of the agent's projects as a SOUL.md section, so the Home agent and the
// coordinators know where the work of each area is kept. Empty when none has an area.
export async function areasSection(agent: AiAgentRow): Promise<string> {
  if (agent.projects.length === 0) return '';
  const rows = await db
    .select({
      projectId: projectViewFolder.projectId,
      name: projectViewFolder.name,
      folder: projectViewFolder.folder,
    })
    .from(projectViewFolder)
    .where(
      inArray(
        projectViewFolder.projectId,
        agent.projects.map((project) => project.id),
      ),
    )
    .orderBy(asc(projectViewFolder.position), asc(projectViewFolder.id));
  return projectAreasSection(
    agent.projects.map((project) => ({
      key: project.key,
      areas: rows.filter((row) => row.projectId === project.id),
    })),
  );
}
