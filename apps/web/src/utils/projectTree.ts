import type { Project } from '@/lib/api/endpoints/projects';

export interface ProjectGroup {
  id: number;
  name: string;
  teamId: number;
  projects: Project[];
}

// The sidebar's project tree: the departments that hold projects, by name, each with
// its projects, and the projects in no department after them.
export function projectTree(projects: Project[]): { groups: ProjectGroup[]; ungrouped: Project[] } {
  const groups = new Map<number, ProjectGroup>();
  const ungrouped: Project[] = [];
  for (const project of projects) {
    if (project.departmentId == null) {
      ungrouped.push(project);
      continue;
    }
    const group = groups.get(project.departmentId) ?? {
      id: project.departmentId,
      name: project.departmentName ?? '',
      teamId: project.teamId,
      projects: [],
    };
    group.projects.push(project);
    groups.set(project.departmentId, group);
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ungrouped,
  };
}

// A project dragged in the sidebar carries its id and team; a group only takes a
// project of its own team.
export const PROJECT_DRAG_TYPE = 'application/x-plan-project';

export function isProjectDrag(event: { dataTransfer: DataTransfer }) {
  return event.dataTransfer.types.includes(PROJECT_DRAG_TYPE);
}

export function draggedProject(event: {
  dataTransfer: DataTransfer;
}): { id: number; teamId: number } | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(PROJECT_DRAG_TYPE)) as unknown;
    const { id, teamId } = (value ?? {}) as { id?: unknown; teamId?: unknown };
    return Number.isInteger(id) && Number.isInteger(teamId)
      ? { id: id as number, teamId: teamId as number }
      : null;
  } catch {
    return null;
  }
}
