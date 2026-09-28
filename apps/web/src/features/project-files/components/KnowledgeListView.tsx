'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { FileImage, FileText, Folder, Network, Plus, Upload, type LucideIcon } from 'lucide-react';
import {
  Menu as DropdownMenu,
  MenuContent as DropdownMenuContent,
  MenuItem as DropdownMenuItem,
  MenuTrigger as DropdownMenuTrigger,
} from '@/design-system';
import KnowledgeFrame, {
  KnowledgeListHead,
  KnowledgePill,
  KnowledgeRow,
  KnowledgeSearch,
  useListKeyboard,
  type KnowledgeCrumb,
} from '@/components/helena/KnowledgeFrame';
import PillButton from '@/components/helena/PillButton';
import { ProjectTag } from '@/components/helena/ProjectTag';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { searchKnowledge } from '@/lib/api/endpoints/knowledge';
import {
  fileRawUrl,
  getFileReferences,
  type FileItem,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import {
  isCanvas,
  isDoc,
  knowledgeDisplayName,
  knowledgeIcons,
  knowledgeKind,
} from '../utils/knowledgeKinds';
import type { FilePermissions } from './FileBrowser';
import FileViewer from '@/components/common/files/FileViewer';
import { Button } from '@/components/ui/button';

// The query of the same folder in the other list (Wissen ↔ Dateien).
function otherKindQuery(params: URLSearchParams | null, kind: KnowledgeListKind) {
  const next = new URLSearchParams(params?.toString() ?? '');
  next.delete('file');
  if (kind === 'files') next.delete('kind');
  else next.set('kind', 'files');
  return next.toString();
}

// One file of a Wissen list, with the folder it belongs to. `item.path` is relative to
// the root of `scope`; `vaultPath` is the canonical vault path.
export interface KnowledgeEntry {
  key: string;
  item: FileItem;
  scope: FileScope;
  vaultPath: string | null;
  // The project of the entry, shown as a tag where a list mixes projects (Home).
  projectKey?: string | null;
  // The folder the entry lives in, shown where a list mixes folders ("Zuletzt geändert").
  location?: string;
}

export interface KnowledgeSearchRoot {
  root: string;
  scope: FileScope;
  projectKey?: string | null;
}

// Wissen lists docs and canvases, Dateien the other files (two entries in the sidebar,
// owner 28.09.: no kind filters above the list). "Von Agenten" narrows either.
export type KnowledgeListKind = 'knowledge' | 'files';
export type KnowledgeCreation = 'doc' | 'canvas' | 'folder' | 'upload';
const creations: KnowledgeCreation[] = ['doc', 'canvas', 'folder', 'upload'];
const creationIcons: Record<KnowledgeCreation, LucideIcon> = {
  doc: FileText,
  canvas: Network,
  folder: Folder,
  upload: FileImage,
};

function ofKind(kind: KnowledgeListKind, item: FileItem) {
  const knowledge = isDoc(item.name) || isCanvas(item.name);
  return kind === 'files' ? !knowledge : knowledge;
}

// The one list of Wissen and Dateien (WissenOrdner.dc.html): files only — folders live in
// the sidebar tree and are never listed a second time here. A click on a doc or canvas
// opens it in the main area; any other file opens its preview in the overlay on the right
// ("Öffnen" there shows it in the main area). ↑/↓ move the selection, Enter opens.
export default function KnowledgeListView({
  crumbs,
  title,
  entries,
  loading = false,
  searchRoots,
  can,
  onOpen,
  onCreate,
  onUpload,
  menuFor,
  rowPropsFor,
  more,
  note,
  emptyText,
}: {
  crumbs: KnowledgeCrumb[];
  title: ReactNode;
  entries: KnowledgeEntry[];
  loading?: boolean;
  searchRoots: KnowledgeSearchRoot[];
  can: FilePermissions;
  onOpen: (entry: KnowledgeEntry) => void;
  onCreate?: (kind: KnowledgeCreation) => void;
  onUpload?: (files: File[]) => void;
  menuFor?: (entry: KnowledgeEntry) => ReactNode;
  rowPropsFor?: (entry: KnowledgeEntry) => Record<string, unknown>;
  more?: ReactNode;
  // A quiet line above the list (e.g. "2 Unterordner").
  note?: ReactNode;
  emptyText: string;
}) {
  const t = useTranslations('files.knowledge');
  const relativeTime = useRelativeTime();
  const params = useSearchParams();
  const kind: KnowledgeListKind = params?.get('kind') === 'files' ? 'files' : 'knowledge';
  const [fromAgents, setFromAgents] = useState(false);
  const [preview, setPreview] = useState<KnowledgeEntry | null>(null);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const create = (kind: KnowledgeCreation) => {
    if (kind === 'upload') upload.current?.click();
    else onCreate?.(kind);
  };
  const authors = useQueries({
    queries: entries.map((entry) => ({
      queryKey: ['knowledge-author', entry.scope, entry.item.path],
      queryFn: () => getFileReferences(entry.scope, entry.item.path),
      enabled: fromAgents,
      retry: false,
    })),
  });
  const hits = useQueries({
    queries: searchRoots.map((root) => ({
      queryKey: ['knowledge-folder-search', root.root, query],
      queryFn: () => searchKnowledge(query, root.root, 50),
      enabled: query.trim().length > 0,
    })),
  });
  const searching = query.trim().length > 0;
  const found: KnowledgeEntry[] = searching
    ? searchRoots.flatMap((root, index) =>
        (hits[index]?.data?.items ?? []).map((hit) => {
          const relative = hit.path.slice(root.root.length + 1);
          const name = relative.split('/').at(-1) ?? hit.title;
          return {
            key: hit.path,
            item: {
              name,
              path: relative,
              kind: 'file' as const,
              contentType: null,
              sizeBytes: null,
              updatedAt: null,
            },
            scope: root.scope,
            vaultPath: hit.path,
            projectKey: root.projectKey,
            location: hit.snippet,
          };
        }),
      )
    : [];
  const shown = searching
    ? found
    : entries.filter(
        (entry, index) =>
          ofKind(kind, entry.item) && (!fromAgents || authors[index]?.data?.authorKind === 'agent'),
      );
  // In a folder of Wissen, the other files of the folder are one click away (and back).
  const others = searching ? 0 : entries.filter((entry) => !ofKind(kind, entry.item)).length;
  const open = (entry: KnowledgeEntry) => {
    if (isDoc(entry.item.name) || isCanvas(entry.item.name)) onOpen(entry);
    else setPreview(entry);
  };
  const selected = shown.find((entry) => entry.key === selectedKey) ?? shown[0];
  const selectedIndex = selected ? shown.indexOf(selected) : -1;
  const { ref: listRef, onKeyDown: onListKeyDown } = useListKeyboard({
    count: shown.length,
    selected: selectedIndex,
    onSelect: (index) => setSelectedKey(shown[index]?.key ?? null),
    onOpen: (index) => shown[index] && open(shown[index]),
  });
  const pending = searching ? hits.some((hit) => hit.isPending) : loading;
  const mixedProjects = new Set(entries.map((entry) => entry.projectKey ?? '')).size > 1;

  const newMenu = can.create && onCreate && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PillButton className="h-8 min-h-8 shrink-0 gap-1 px-3">
          <Plus size={14} aria-hidden="true" />
          {t('new')}
        </PillButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {creations
          .filter((kind) => kind !== 'upload' || onUpload)
          .map((kind) => {
            const Icon = creationIcons[kind];
            return (
              <DropdownMenuItem key={kind} onSelect={() => create(kind)}>
                <Icon />
                {t(`create.${kind}`)}
              </DropdownMenuItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const where = (entry: KnowledgeEntry) =>
    entry.projectKey && mixedProjects ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <ProjectTag projectKey={entry.projectKey} />
        <span className="truncate">{entry.location}</span>
      </span>
    ) : (
      entry.location
    );

  return (
    <>
      <KnowledgeFrame
        crumbs={crumbs}
        title={title}
        search={
          <KnowledgeSearch
            value={query}
            onChange={setQuery}
            placeholder={kind === 'files' ? t('searchFiles') : t('searchPlaceholder')}
            inputRef={search}
          />
        }
        actions={
          (newMenu || more) && (
            <>
              {newMenu}
              {more}
            </>
          )
        }
        pills={
          !searching && (
            <KnowledgePill active={fromAgents} onClick={() => setFromAgents(!fromAgents)}>
              {t('filters.agents')}
            </KnowledgePill>
          )
        }
        footer={
          can.create &&
          onUpload && (
            <button
              type="button"
              data-knowledge-dropzone=""
              onClick={() => upload.current?.click()}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                event.stopPropagation();
                setDropping(false);
                onUpload(Array.from(event.dataTransfer.files));
              }}
              className="ds-dropzone"
              data-dropping={dropping ? 'true' : undefined}
            >
              <Upload size={14} aria-hidden="true" />
              <span>
                {t.rich('dropHint', {
                  pick: (chunks) => <span className="text-brand">{chunks}</span>,
                })}
              </span>
            </button>
          )
        }
      >
        {note && !searching && <p className="-mt-2 px-3.5 text-xs text-muted-foreground">{note}</p>}
        <KnowledgeListHead
          name={t('columns.name')}
          kind={searching ? t('columns.match') : t('columns.kind')}
          trailing={t('columns.changed')}
        />
        {/* Arrow keys move through the rows; the rows themselves are buttons. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          ref={listRef}
          onKeyDown={onListKeyDown}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
        >
          {pending && (
            <p role="status" className="px-3.5 py-3 text-xs text-muted-foreground">
              {searching ? t('searching') : t('loading')}
            </p>
          )}
          {!pending && shown.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-muted-foreground">
              {searching ? t('noResults') : fromAgents ? t('emptyFilter') : emptyText}
            </p>
          )}
          {shown.map((entry, index) => {
            const kind = knowledgeKind(entry.item);
            return (
              <KnowledgeRow
                key={entry.key}
                index={index}
                icon={knowledgeIcons[kind]}
                name={knowledgeDisplayName(entry.item.name)}
                title={entry.vaultPath ?? entry.item.name}
                detail={
                  searching ? (
                    entry.location
                  ) : entry.location !== undefined ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0">{t(`kinds.${kind}`)}</span>
                      <span aria-hidden="true">{'·'}</span>
                      {where(entry)}
                    </span>
                  ) : (
                    t(`kinds.${kind}`)
                  )
                }
                trailing={entry.item.updatedAt ? relativeTime(entry.item.updatedAt) : '—'}
                selected={selected?.key === entry.key}
                onClick={() => {
                  setSelectedKey(entry.key);
                  open(entry);
                }}
                onDoubleClick={() => open(entry)}
                menu={menuFor?.(entry)}
                rowProps={rowPropsFor?.(entry)}
              />
            );
          })}
        </div>
        {others > 0 && (
          <Link
            className="ds-knowledge-others"
            href={`?${otherKindQuery(params, kind)}`}
            scroll={false}
          >
            {t(kind === 'files' ? 'othersKnowledge' : 'othersFiles', { count: others })}
          </Link>
        )}
      </KnowledgeFrame>
      {preview && (
        <FileViewer
          file={{
            name: preview.item.name,
            contentType: preview.item.contentType,
            sizeBytes: preview.item.sizeBytes,
            url: fileRawUrl(preview.scope, preview.item.path),
            vaultPath: preview.vaultPath,
          }}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const entry = preview;
                  setPreview(null);
                  onOpen(entry);
                }}
              >
                {t('openInPage')}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={fileRawUrl(preview.scope, preview.item.path, true)}>{t('download')}</a>
              </Button>
            </>
          }
          onClose={() => setPreview(null)}
        />
      )}
      {onUpload && (
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            onUpload(Array.from(event.target.files ?? []));
            event.currentTarget.value = '';
          }}
        />
      )}
    </>
  );
}
