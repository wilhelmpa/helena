'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { usePermissions } from '@/hooks/usePermissions';
import { useSession } from '@/lib/auth-client';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { useProjectQuery, useProjectsQuery } from '@/services/projects.service';
import { homeFilesPath } from '@/utils/paths';
import FileBrowser from './components/FileBrowser';
import { useFileNavigationGuard } from './hooks/useFileNavigationGuard';
import type { HomeFilesRoot } from './components/HomeFilesRoots';

function currentRoot(root: string | null, project: string | null): HomeFilesRoot {
  if (root === 'private' || root === 'templates') return root;
  if (root === 'project' && project) return `project:${project}`;
  return 'home';
}

// Every folder of the vault on one page: Home, Private (the owner's), Templates, and
// the folder of each project with its own permissions.
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
  const projects = (useProjectsQuery().data ?? []).filter((project) => project.documentsEnabled);
  const owner = mounted && session?.user.role === 'god';
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

  const go = (next: { root?: HomeFilesRoot; path?: string; file?: string | null }) => {
    if (next.root !== undefined && !navigation.canLeave()) return;
    const root = next.root ?? current;
    const project = root.startsWith('project:') ? root.slice('project:'.length) : undefined;
    router.push(
      homeFilesPath(next.path ?? path, {
        root: project ? 'project' : root === 'home' ? undefined : root,
        project,
        file: next.file,
      }),
    );
  };

  return (
    <Shell globalHome globalTitle={tNav('files')} autoOpenGlobalChat={false}>
      <div className="flex h-full min-h-0 flex-col p-4">
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
      </div>
    </Shell>
  );
}
