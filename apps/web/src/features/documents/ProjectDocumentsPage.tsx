'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import DocumentLoadingState from './components/DocumentLoadingState';
import DocumentsWorkspace from './components/DocumentsWorkspace';

// The Docs of a project: the notes under Projects/<KEY>/Docs in the vault.
export default function ProjectDocumentsPage() {
  const t = useTranslations('documents');
  const { project } = useShell();
  const { can } = usePermissions();

  useLiveRefresh({
    scope: project ? revScope.documents(project.project.id) : null,
    targets: [qk.knowledge],
  });

  if (!project) return <DocumentLoadingState />;
  if (!can('documents', 'read')) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {t('noAccess')}
      </div>
    );
  }
  return (
    <DocumentsWorkspace
      root={`Projects/${project.project.key}/Docs`}
      canEdit={can('documents', 'edit')}
    />
  );
}
