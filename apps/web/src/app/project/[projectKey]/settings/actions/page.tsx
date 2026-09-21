import { redirect } from 'next/navigation';
import { projectPath } from '@/utils/paths';

export default async function Page({ params }: { params: Promise<{ projectKey: string }> }) {
  const { projectKey } = await params;
  redirect(`${projectPath(projectKey)}/workflows`);
}
