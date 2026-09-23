import path from 'node:path';
import { HttpError } from '#shared/lib';

const DEFAULT_VAULT_ROOT = '/srv/volition/vault';
const DEFAULT_WORKSPACE_ROOT = '/srv/volition/workspaces/projects';

export const PROJECT_ROOTS = ['vault', 'code'] as const;
export const HOME_ROOTS = ['home', 'private', 'templates'] as const;
export type ProjectRootName = (typeof PROJECT_ROOTS)[number];
export type HomeRootName = (typeof HOME_ROOTS)[number];
export type FileRootName = ProjectRootName | HomeRootName;

// One folder the Files page browses. `vaultPath` is the root's path relative to the
// vault, the form the Docs page, Obsidian and attachment rows use; a workspace has
// none. A root Plan may not create (the private folder, whose group keeps the agents
// out, and a workspace) is only ever read or written when it exists. `trashPath` is
// the vault folder its deleted entries move to, at their path relative to the root.
export interface FileRoot {
  name: FileRootName;
  directory: string;
  vaultPath: string | null;
  writable: boolean;
  creatable: boolean;
  trashPath: string | null;
}

export function vaultDirectory(): string {
  return path.resolve(process.env.PROJECT_VAULT_ROOT?.trim() || DEFAULT_VAULT_ROOT);
}

function workspaceDirectory(): string {
  return path.resolve(process.env.PROJECT_WORKSPACE_ROOT?.trim() || DEFAULT_WORKSPACE_ROOT);
}

export function projectFilesSlug(projectKey: string): string {
  const key = projectKey.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(key)) throw new HttpError(400, 'Project key is invalid');
  return key;
}

// The provisioning service names a workspace after the lower-cased key; VERV is the
// one project created before that rule.
function workspaceSlug(projectKey: string): string {
  const key = projectFilesSlug(projectKey);
  return key === 'VERV' ? 'verve' : key.toLowerCase();
}

export const projectVaultPath = (projectKey: string) => `Projects/${projectFilesSlug(projectKey)}`;

// Deleted entries move to the vault's .trash at the same relative path, which is where
// Obsidian puts them too. The private folder has a trash of its own, because the
// vault's is readable by the agents.
function vaultRoot(name: FileRootName, vaultPath: string, creatable: boolean): FileRoot {
  return {
    name,
    directory: path.join(vaultDirectory(), vaultPath),
    vaultPath,
    writable: true,
    creatable,
    trashPath: name === 'private' ? `${vaultPath}/.trash` : `.trash/${vaultPath}`,
  };
}

export function projectRoot(projectKey: string, name: ProjectRootName = 'vault'): FileRoot {
  if (name === 'vault') return vaultRoot('vault', projectVaultPath(projectKey), true);
  return {
    name,
    directory: path.join(workspaceDirectory(), workspaceSlug(projectKey)),
    vaultPath: null,
    writable: false,
    creatable: false,
    trashPath: null,
  };
}

const HOME_FOLDERS: Record<HomeRootName, string> = {
  home: 'Home',
  private: 'Private',
  templates: 'Templates',
};

export function homeRoot(name: HomeRootName): FileRoot {
  return vaultRoot(name, HOME_FOLDERS[name], name !== 'private');
}

// Splits a vault-relative path into the root it belongs to and the path below it.
export function rootOfVaultPath(vaultPath: string): { root: FileRoot; relative: string } | null {
  const [first, second, ...rest] = vaultPath.split('/');
  if (first === 'Projects' && second) {
    return { root: projectRoot(second), relative: rest.join('/') };
  }
  const home = HOME_ROOTS.find((name) => HOME_FOLDERS[name] === first);
  return home
    ? { root: homeRoot(home), relative: [second, ...rest].filter(Boolean).join('/') }
    : null;
}
