'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectFileRoot } from '@/lib/api/endpoints/projectFiles';
import { filesPath } from '@/utils/paths';
import FileBrowser from './components/FileBrowser';
import FileRootTabs from './components/FileRootTabs';

// A project's files: its vault folder ("Wissen") and its workspace ("Code"). The root,
// the folder and the open file are in the address.
export default function ProjectFilesPage() {
  const t = useTranslations('files');
  const { projectKey } = useParams<{ projectKey: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = usePermissions();
  const root: ProjectFileRoot = params.get('root') === 'code' ? 'code' : 'vault';
  const path = params.get('path') ?? '';
  const go = (next: { root?: ProjectFileRoot; path?: string; file?: string | null }) => {
    const nextRoot = next.root ?? root;
    router.push(
      filesPath(projectKey, next.path ?? path, {
        root: nextRoot === 'code' ? 'code' : undefined,
        file: next.file,
      }),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={t('title')} description={t('projectDescription')} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <FileRootTabs root={root} onChange={(next) => go({ root: next, path: '' })} />
        <FileBrowser
          key={root}
          scope={{ kind: 'project', projectKey, root }}
          path={path}
          selected={params.get('file')}
          rootLabel={t(`roots.${root}`)}
          permissions={{
            create: can('documents', 'create'),
            edit: can('documents', 'edit'),
            delete: can('documents', 'delete'),
          }}
          onNavigate={(next) => go({ path: next, file: null })}
          onSelect={(file) => go({ file })}
        />
      </div>
    </div>
  );
}
