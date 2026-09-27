'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
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
  const path = useSearchParams().get('path');

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
  const base = `Projects/${project.project.key}`;
  const docs = `${base}/Docs`;
  const root =
    path?.startsWith(`${base}/`) && /\.md$/i.test(path)
      ? path.startsWith(`${docs}/`)
        ? docs
        : path.slice(0, path.lastIndexOf('/'))
      : docs;
  return <DocumentsWorkspace root={root} canEdit={can('documents', 'edit')} />;
}
