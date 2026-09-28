'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import type { ProjectFileRoot } from '@/lib/api/endpoints/projectFiles';
import { filesPath } from '@/utils/paths';
import NotesPage from '@/features/notes/NotesPage';
import { useNoteBoardQuery } from '@/features/notes/services/noteBoards.service';
import FileBrowser from './components/FileBrowser';
import { useFileNavigationGuard } from './hooks/useFileNavigationGuard';

function LegacyBoard({
  projectKey,
  id,
  canvas,
}: {
  projectKey: string;
  id: number | null;
  canvas: string | null;
}) {
  const router = useRouter();
  const board = useNoteBoardQuery(projectKey, id);
  useEffect(() => {
    const vaultPath = canvas || board.data?.vaultPath;
    if (!vaultPath) return;
    const prefix = `Projects/${projectKey}/`;
    if (!vaultPath.startsWith(prefix)) return;
    const relative = vaultPath.slice(prefix.length);
    router.replace(
      filesPath(projectKey, relative.split('/').slice(0, -1).join('/'), { file: relative }),
    );
  }, [board.data, canvas, projectKey, router]);
  useEffect(() => {
    if (id === null && !canvas) router.replace(filesPath(projectKey, 'Boards'));
  }, [id, canvas, projectKey, router]);
  if (id !== null && board.data && !board.data.vaultPath) return <NotesPage />;
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      {'Leinwand wird geöffnet …'}
    </div>
  );
}

export default function ProjectFilesPage() {
  const t = useTranslations('files');
  const navigation = useFileNavigationGuard();
  const { projectKey } = useParams<{ projectKey: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = usePermissions();
  const features = useProjectFeatures();
  const boardView = params.get('view') === 'boards';
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
  if (!features.documents && features.notes) return <NotesPage />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {root === 'code' && <WorkspacePageHeader title={t('title')} />}
      <div
        className={
          root === 'vault' ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col p-4'
        }
      >
        {boardView ? (
          <LegacyBoard
            projectKey={projectKey}
            id={Number(params.get('board')) || null}
            canvas={params.get('canvas')}
          />
        ) : (
          <FileBrowser
            key={root}
            onDirtyChange={navigation.onDirty}
            scope={{ kind: 'project', projectKey, root }}
            path={path}
            selected={params.get('file')}
            sourceOnly={params.get('source') === '1'}
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
