'use client';

import type { ReactNode } from 'react';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookOpen, Code2, StickyNote } from 'lucide-react';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import { PageTabs } from '@/components/layout/PageToolbar';
import { PageToolbarNavigationProvider } from '@/context/pageToolbarNavigation';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectFileRoot } from '@/lib/api/endpoints/projectFiles';
import { filesPath } from '@/utils/paths';
import FileBrowser from './components/FileBrowser';
import { useFileNavigationGuard } from './hooks/useFileNavigationGuard';

// A project's files: its vault folder ("Wissen") and its workspace ("Code"). The root,
// the folder and the open file are in the address.
export default function ProjectFilesPage({ boards }: { boards?: ReactNode }) {
  const t = useTranslations('files');
  const navigation = useFileNavigationGuard();
  const { projectKey } = useParams<{ projectKey: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const boardsEnabled = features.notes && can('note_boards', 'read');
  const boardView = params.get('view') === 'boards' && boardsEnabled;
  const root: ProjectFileRoot = params.get('root') === 'code' ? 'code' : 'vault';
  const path = params.get('path') ?? '';
  const go = (next: { root?: ProjectFileRoot; path?: string; file?: string | null }) => {
    if (next.root !== undefined && !navigation.canLeave()) return;
    const nextRoot = next.root ?? root;
    router.push(
      filesPath(projectKey, next.path ?? path, {
        root: nextRoot === 'code' ? 'code' : undefined,
        file: next.file,
      }),
    );
  };

  const tabs = (
    <PageTabs
      label={t('title')}
      value={boardView ? 'boards' : root}
      onChange={(next) =>
        next === 'boards'
          ? navigation.canLeave() && router.push(`${filesPath(projectKey)}?view=boards`)
          : go({ root: next as ProjectFileRoot, path: '' })
      }
      items={[
        { value: 'vault', label: t('roots.vault'), icon: BookOpen },
        ...(boardsEnabled
          ? [{ value: 'boards', label: t('unified.boards'), icon: StickyNote }]
          : []),
        { value: 'code', label: t('roots.code'), icon: Code2 },
      ]}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={t('title')} />
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {boardView ? (
          <PageToolbarNavigationProvider navigation={tabs}>{boards}</PageToolbarNavigationProvider>
        ) : (
          <FileBrowser
            key={root}
            leading={tabs}
            onDirtyChange={navigation.onDirty}
            scope={{ kind: 'project', projectKey, root }}
            path={path}
            selected={params.get('file')}
            sourceOnly={params.get('source') === '1'}
            createRequest={params.get('create')}
            onCreateHandled={() => {
              const next = new URLSearchParams(params.toString());
              next.delete('create');
              router.replace(`${filesPath(projectKey)}${next.size ? `?${next}` : ''}`);
            }}
            rootLabel={t(`roots.${root}`)}
            permissions={{
              create: can('documents', 'create'),
              edit: can('documents', 'edit'),
              delete: can('documents', 'delete'),
            }}
            onNavigate={(next) => go({ path: next, file: null })}
            onSelect={(file) =>
              go({
                file,
                ...(file
                  ? { path: file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '' }
                  : {}),
              })
            }
          />
        )}
      </div>
    </div>
  );
}
