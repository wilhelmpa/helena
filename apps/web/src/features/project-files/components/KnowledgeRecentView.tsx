'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import type { KnowledgeCrumb } from '@/components/helena/KnowledgeFrame';
import { listRecentVaultFiles } from '@/lib/api/endpoints/knowledge';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { filesScopeKey } from '@/services/files.service';
import { knowledgeFolderLabel } from '@/utils/knowledgeFolders';
import type { FilePermissions } from './FileBrowser';
import KnowledgeListView, {
  type KnowledgeCreation,
  type KnowledgeEntry,
} from './KnowledgeListView';

// One vault root the overview reads: a project's folder, or Home, Private, Templates.
export interface KnowledgeSource {
  root: string;
  scope: FileScope;
  projectKey?: string | null;
  // Shown before the folder where the list mixes roots (Home: "Privat / Notizen").
  label?: string;
}

const LIMIT = 100;

// Level 1 of Wissen (docs/ui-system.md §13): no folder list — the sidebar tree holds the
// folders — but the latest files across all of them, newest first, with search and the
// origin filters; Wissen shows docs, canvases and views, Dateien (?kind=files) the rest.
// In Home the same over Helena, Privat, Vorlagen and every project, each file with its
// place and project tag, so it is clear where it comes from (O14).
export default function KnowledgeRecentView({
  sources,
  crumbs,
  title,
  can,
  onOpen,
  onCreate,
  onUpload,
  menuFor,
  more,
}: {
  sources: KnowledgeSource[];
  crumbs: KnowledgeCrumb[];
  title: ReactNode;
  can: FilePermissions;
  onOpen: (entry: KnowledgeEntry) => void;
  onCreate?: (kind: KnowledgeCreation) => void;
  onUpload?: (files: File[]) => void;
  menuFor?: (entry: KnowledgeEntry) => ReactNode;
  more?: ReactNode;
}) {
  const t = useTranslations('files.knowledge');
  const params = useSearchParams();
  const fixed = useTranslations('files.fixedFolders');
  const results = useQueries({
    queries: sources.map((source) => ({
      queryKey: [...filesScopeKey(source.scope), 'recent', source.root],
      queryFn: () => listRecentVaultFiles(source.root, LIMIT),
      retry: false,
    })),
  });
  const entries: KnowledgeEntry[] = sources
    .flatMap((source, index) =>
      (results[index]?.data?.items ?? []).map((file) => {
        const relative = file.path.slice(source.root.length + 1);
        const folders = relative.split('/').slice(0, -1);
        const folder = folders
          .map((segment, depth) =>
            depth === 0 && source.scope.kind === 'project'
              ? knowledgeFolderLabel(segment, fixed)
              : segment,
          )
          .join(' / ');
        return {
          key: file.path,
          item: {
            name: file.name,
            path: relative,
            kind: 'file' as const,
            contentType: file.mime,
            sizeBytes: file.sizeBytes,
            updatedAt: file.updatedAt,
            origin: file.origin,
          },
          scope: source.scope,
          vaultPath: file.path,
          projectKey: source.projectKey,
          location: [source.label, folder].filter(Boolean).join(' / ') || t('topLevel'),
        };
      }),
    )
    .sort((a, b) => (b.item.updatedAt ?? '').localeCompare(a.item.updatedAt ?? ''))
    .slice(0, LIMIT);
  return (
    <KnowledgeListView
      crumbs={crumbs}
      title={title}
      entries={entries}
      loading={results.some((result) => result.isPending)}
      searchRoots={sources.map((source) => ({
        root: source.root,
        scope: source.scope,
        projectKey: source.projectKey,
      }))}
      can={can}
      onOpen={onOpen}
      onCreate={onCreate}
      onUpload={onUpload}
      menuFor={menuFor}
      more={more}
      emptyText={params?.get('kind') === 'files' ? t('emptyFiles') : t('emptyRecent')}
    />
  );
}
