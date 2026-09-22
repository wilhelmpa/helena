import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectFilesPage from '@/features/project-files/ProjectFilesPage';

export default function Page() {
  return (
    <RequireFeature feature="documents">
      <ProjectFilesPage />
    </RequireFeature>
  );
}
