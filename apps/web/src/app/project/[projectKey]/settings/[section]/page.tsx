import { notFound, redirect } from 'next/navigation';
import ProjectSettingsModalContent from '@/features/settings/ProjectSettingsModalContent';

// Pages of a project's settings that have no page folder of their own. Some merged into
// another page (owner, 28.09.): Standard-Ausführung and Budgets into Autopilot &
// Ausführung; the old link pages "Werkzeuge" and "Integrationen" lead to their first page.
const MOVED: Record<string, string> = {
  agents: 'autopilot',
  budgets: 'autopilot',
  tools: 'browser',
  integrations: 'git',
  credentials: 'environment',
};
const virtualSections = new Set(['knowledge', 'mail']);

export default async function Page({
  params,
}: {
  params: Promise<{ projectKey: string; section: string }>;
}) {
  const { projectKey, section } = await params;
  const moved = MOVED[section];
  if (moved) redirect(`/project/${encodeURIComponent(projectKey)}/settings/${moved}`);
  if (!virtualSections.has(section)) notFound();
  return <ProjectSettingsModalContent slug={section} />;
}
