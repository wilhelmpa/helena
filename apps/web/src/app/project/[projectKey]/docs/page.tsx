import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectDocumentsPage from '@/features/documents/ProjectDocumentsPage';

export default function Page() {
  return (
    <RequireFeature feature="documents">
      <ProjectDocumentsPage />
    </RequireFeature>
  );
}
