import { notFound } from 'next/navigation';
import ProjectSettingsModalContent from '@/features/settings/ProjectSettingsModalContent';

const virtualSections = new Set([
  'agents',
  'budgets',
  'tools',
  'knowledge',
  'mail',
  'integrations',
]);

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!virtualSections.has(section)) notFound();
  return <ProjectSettingsModalContent slug={section} />;
}
