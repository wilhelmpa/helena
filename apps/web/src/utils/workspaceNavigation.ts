import { projectPath } from './paths';

export function safeProjectDestination(projectKey: string, saved: string | null): string {
  const base = projectPath(projectKey);
  if (
    !saved ||
    saved.length > 500 ||
    /[\\?#]/.test(saved) ||
    [...saved].some((char) => char.charCodeAt(0) < 32)
  )
    return base;
  if (saved !== base && !saved.startsWith(`${base}/`)) return base;
  // Do not accept encoded separators or dot segments from browser storage.
  if (
    /%(?:2f|5c|2e)/i.test(saved) ||
    saved.split('/').some((part) => part === '.' || part === '..')
  )
    return base;
  return saved;
}

const PROJECT_SECTION_ROOTS = new Set([
  'dashboard',
  'organization',
  'workflows',
  'inbox',
  'files',
  'code',
  'docs',
  'initiatives',
  'cycles',
  'notes',
  'ai-agents',
  'mcp',
  'members',
  'notifications',
]);

const PROJECT_SETTINGS_SECTIONS = new Set([
  'actions',
  'configuration',
  'custom-fields',
  'general',
  'git',
  'issue-templates',
  'issue-types',
  'labels',
  'network',
  'states',
  'webhooks',
]);

const PROJECT_AI_TEAM_SECTIONS = new Set(['chat', 'schedules']);

export function matchingProjectDestination(
  currentProjectKey: string | null,
  nextProjectKey: string,
  pathname: string,
): string | null {
  if (!currentProjectKey) return null;
  const currentBase = projectPath(currentProjectKey);
  if (safeProjectDestination(currentProjectKey, pathname) !== pathname) return null;
  const parts = pathname.slice(currentBase.length).split('/').filter(Boolean);
  const [root, section] = parts;
  if (!root || root === 'view' || root === 'issue') return projectPath(nextProjectKey);
  if (root === 'settings')
    return section && PROJECT_SETTINGS_SECTIONS.has(section)
      ? `${projectPath(nextProjectKey)}/settings/${section}`
      : projectPath(nextProjectKey);
  if (root === 'ai-team')
    return section && PROJECT_AI_TEAM_SECTIONS.has(section)
      ? `${projectPath(nextProjectKey)}/ai-team/${section}`
      : projectPath(nextProjectKey);
  return PROJECT_SECTION_ROOTS.has(root)
    ? `${projectPath(nextProjectKey)}/${root}`
    : projectPath(nextProjectKey);
}
