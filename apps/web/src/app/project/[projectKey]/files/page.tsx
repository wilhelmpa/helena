import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectFilesPage from '@/features/project-files/ProjectFilesPage';
import NotesPage from '@/features/notes/NotesPage';

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return (
    <RequireFeature feature={view === 'boards' ? 'notes' : 'documents'}>
      <ProjectFilesPage boards={<NotesPage />} />
    </RequireFeature>
  );
}
