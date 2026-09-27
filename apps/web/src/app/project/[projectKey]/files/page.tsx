import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectFilesPage from '@/features/project-files/ProjectFilesPage';
import NotesPage from '@/features/notes/NotesPage';
import { redirect } from 'next/navigation';
import { vaultNotePath } from '@/utils/paths';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<{ view?: string; root?: string; file?: string; source?: string }>;
}) {
  const [{ projectKey }, { view, root, file, source }] = await Promise.all([params, searchParams]);
  if (file && /\.md$/i.test(file) && root !== 'code' && source !== '1')
    redirect(vaultNotePath(`Projects/${projectKey}/${file}`));
  return (
    <RequireFeature feature={view === 'boards' ? 'notes' : 'documents'}>
      <ProjectFilesPage boards={<NotesPage />} />
    </RequireFeature>
  );
}
