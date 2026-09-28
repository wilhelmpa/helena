'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { usePermissions } from '@/hooks/usePermissions';
import { useSession } from '@/lib/auth-client';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { useProjectQuery, useProjectsQuery } from '@/services/projects.service';
import { useUploadFiles } from '@/features/project-files/services/projectFiles.service';
import { homeFilesPath } from '@/utils/paths';
import FileBrowser from './components/FileBrowser';
import FileBrowserDialogs, { type FileDialogState } from './components/FileBrowserDialogs';
import KnowledgeRecentView, { type KnowledgeSource } from './components/KnowledgeRecentView';
import { useFileNavigationGuard } from './hooks/useFileNavigationGuard';
import type { HomeFilesRoot } from './components/HomeFilesRoots';

function currentRoot(root: string | null, project: string | null): HomeFilesRoot {
  if (root === 'private' || root === 'templates') return root;
  if (root === 'project' && project) return `project:${project}`;
  return 'home';
}

// Home → Wissen. Without a folder (level 1 of the tree) the latest files of Home, Private,
// Templates and every project, each with its project tag; the folders themselves are in
// the sidebar tree. A root (?root=home|private|templates|project) opens that folder.
export default function HomeFilesPage() {
  const t = useTranslations('files');
  const navigation = useFileNavigationGuard();
  const tNav = useTranslations('nav');
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  // The session is read after mount so the first client render matches the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [dialog, setDialog] = useState<FileDialogState>(null);
  const projects = (useProjectsQuery().data ?? []).filter((project) => project.documentsEnabled);
  const owner = mounted && session?.user.role === 'god';
  const overview =
    !params.get('root') && !params.get('path') && !params.get('file') && !params.get('project');
  const current = currentRoot(
    params.get('root') ?? (owner ? 'home' : 'templates'),
    params.get('project'),
  );
  const projectKey = current.startsWith('project:') ? current.slice('project:'.length) : null;
  const { can } = usePermissions(useProjectQuery(projectKey).data);
  const path = params.get('path') ?? '';
  const scope: FileScope = projectKey
    ? { kind: 'project', projectKey, root: 'vault' }
    : { kind: 'home', root: current as 'home' | 'private' | 'templates' };
  const homeScope: FileScope = { kind: 'home', root: owner ? 'home' : 'templates' };
  const upload = useUploadFiles(homeScope);

  const go = (next: { root?: HomeFilesRoot; path?: string; file?: string | null }) => {
    if (next.root !== undefined && !navigation.canLeave()) return;
    const root = next.root ?? current;
    const project = root.startsWith('project:') ? root.slice('project:'.length) : undefined;
    router.push(
      homeFilesPath(next.path ?? path, {
        root: project ? 'project' : root,
        project,
        file: next.file,
      }),
    );
  };

  const sources: KnowledgeSource[] = [
    ...(owner
      ? ([
          { root: 'Home', scope: { kind: 'home', root: 'home' }, label: t('roots.home') },
          { root: 'Private', scope: { kind: 'home', root: 'private' }, label: t('roots.private') },
        ] satisfies KnowledgeSource[])
      : []),
    {
      root: 'Templates',
      scope: { kind: 'home', root: 'templates' },
      label: t('roots.templates'),
    },
    ...projects.map(
      (project): KnowledgeSource => ({
        root: `Projects/${project.key}`,
        scope: { kind: 'project', projectKey: project.key, root: 'vault' },
        projectKey: project.key,
      }),
    ),
  ];

  return (
    <Shell globalHome globalTitle={tNav('files')} autoOpenGlobalChat={false}>
      <div className="flex h-full min-h-0 flex-col">
        {overview ? (
          <>
            <KnowledgeRecentView
              sources={mounted ? sources : []}
              crumbs={[{ label: tNav('home') }, { label: t('roots.vault') }]}
              title={t('knowledge.recent')}
              can={{ create: owner, edit: owner, delete: owner }}
              onOpen={(entry) => {
                const folder = entry.item.path.includes('/')
                  ? entry.item.path.slice(0, entry.item.path.lastIndexOf('/'))
                  : '';
                const target = entry.scope;
                router.push(
                  homeFilesPath(folder, {
                    root: target.kind === 'project' ? 'project' : target.root,
                    project: target.kind === 'project' ? target.projectKey : undefined,
                    file: entry.item.path,
                  }),
                );
              }}
              onCreate={(kind) =>
                setDialog({
                  kind: kind === 'doc' ? 'newFile' : kind === 'canvas' ? 'newCanvas' : 'newFolder',
                })
              }
              onUpload={(files) => upload.mutate({ folder: '', files })}
            />
            <FileBrowserDialogs
              scope={homeScope}
              folder=""
              dialog={dialog}
              projectKey={null}
              onCreatedFile={(created) =>
                router.push(
                  homeFilesPath(
                    created.includes('/') ? created.slice(0, created.lastIndexOf('/')) : '',
                    { root: homeScope.root, file: created },
                  ),
                )
              }
              onClose={() => setDialog(null)}
            />
          </>
        ) : (
          <FileBrowser
            key={current}
            onDirtyChange={navigation.onDirty}
            scope={scope}
            path={path}
            selected={params.get('file')}
            sourceOnly={params.get('source') === '1'}
            rootLabel={
              projectKey
                ? (projects.find((project) => project.key === projectKey)?.name ?? projectKey)
                : t(`roots.${current as 'home' | 'private' | 'templates'}`)
            }
            permissions={
              projectKey
                ? {
                    create: can('documents', 'create'),
                    edit: can('documents', 'edit'),
                    delete: can('documents', 'delete'),
                  }
                : { create: owner, edit: owner, delete: owner }
            }
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
    </Shell>
  );
}
