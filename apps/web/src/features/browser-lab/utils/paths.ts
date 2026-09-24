import { projectPath } from '@/utils/paths';

// Browser 2.0 (docs/helena-decisions/browser-task.md §3.5): in a project, or on Home's own browser.
export const browserLabPath = (projectKey?: string | null) =>
  projectKey ? `${projectPath(projectKey)}/browser-lab` : '/browsers/lab';
