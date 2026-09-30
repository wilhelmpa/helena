import type { CatalogScope } from '@/lib/api/endpoints/catalog';

// Whom an adopted entry is given to: nobody yet (it lands in the library), every agent of
// a project, one agent, or the agents holding a role (optionally in one project).
export type ScopeMode = 'library' | 'project' | 'agent' | 'role';
export interface ScopeChoice {
  mode: ScopeMode;
  projectId: number | null;
  agentId: number | null;
  roleId: number | null;
}

export const emptyScope: ScopeChoice = {
  mode: 'library',
  projectId: null,
  agentId: null,
  roleId: null,
};

// The choice an existing installation was made with, so an update keeps its assignment.
export function choiceOf(scope: CatalogScope | null | undefined): ScopeChoice {
  if (!scope) return emptyScope;
  if (scope.agentId)
    return { mode: 'agent', projectId: null, agentId: scope.agentId, roleId: null };
  if (scope.roleId)
    return {
      mode: 'role',
      projectId: scope.projectId ?? null,
      agentId: null,
      roleId: scope.roleId,
    };
  if (scope.projectId)
    return { mode: 'project', projectId: scope.projectId, agentId: null, roleId: null };
  return emptyScope;
}

// The scope to send, or null while the choice is not complete.
export function scopeOf(choice: ScopeChoice): CatalogScope | null {
  switch (choice.mode) {
    case 'library':
      return {};
    case 'project':
      return choice.projectId ? { projectId: choice.projectId } : null;
    case 'agent':
      return choice.agentId ? { agentId: choice.agentId } : null;
    case 'role':
      return choice.roleId
        ? { roleId: choice.roleId, ...(choice.projectId ? { projectId: choice.projectId } : {}) }
        : null;
  }
}
