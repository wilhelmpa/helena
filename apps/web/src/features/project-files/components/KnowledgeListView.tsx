'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import {
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  ListFilter,
  Network,
  Paperclip,
  Plus,
  SearchX,
  TableProperties,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Inline,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  PAGE_CONTROL_CLASS,
  PAGE_PRIMARY_CLASS,
  PageSelect,
  Segmented,
  Text,
} from '@/design-system';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import KnowledgeFrame, {
  KnowledgeListHead,
  KnowledgeRow,
  KnowledgeSearch,
  useListKeyboard,
  type KnowledgeCrumb,
} from '@/components/helena/KnowledgeFrame';
import { ProjectTag } from '@/components/helena/ProjectTag';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { searchKnowledge } from '@/lib/api/endpoints/knowledge';
import type { FileItem, FileOrigin, FileScope } from '@/lib/api/endpoints/projectFiles';
import {
  isKnowledge,
  knowledgeDisplayName,
  knowledgeIcons,
  knowledgeKind,
} from '../utils/knowledgeKinds';
import type { FilePermissions } from './FileBrowser';
import KnowledgePreview from './KnowledgePreview';
import OriginBadge from './OriginBadge';

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

// Wissen lists docs, canvases and views; Dateien every other file — the two views of the
// latest files of a place. A folder lists everything in it.
export type KnowledgeListKind = 'knowledge' | 'files' | 'all';
export type KnowledgeCreation = 'doc' | 'canvas' | 'base' | 'folder' | 'upload';
const creations: KnowledgeCreation[] = ['doc', 'canvas', 'base', 'folder', 'upload'];
const creationIcons: Record<KnowledgeCreation, LucideIcon> = {
  doc: FileText,
  canvas: Network,
  base: TableProperties,
  folder: Folder,
  upload: FileImage,
};
const ORIGINS: (FileOrigin | 'all')[] = ['all', 'manual', 'agent', 'system'];

function ofKind(kind: KnowledgeListKind, item: FileItem) {
  if (kind === 'all') return true;
  return kind === 'files' ? !isKnowledge(item.name) : isKnowledge(item.name);
}

function rootOf(scope: FileScope): string {
  return scope.kind === 'project'
    ? `Projects/${scope.projectKey}`
    : scope.root === 'home'
      ? 'Home'
      : scope.root === 'private'
        ? 'Private'
        : 'Templates';
}

// The one list of Wissen, Dateien and a folder (WissenOrdner.dc.html): files only — folders
// live in the sidebar tree. A click opens the file on the right (owner 29.09., O49: docs
// and PDFs too), where it can be read and edited; full screen there, or a double click,
// opens it large in the page. ↑/↓ move the selection, Enter opens. Every row says where
// the file came from when it was not a person (system, agent), and the pills filter by it.
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
  onRename,
  onTrash,
  more,
  emptyText,
  kind: forcedKind,
  subfolders = [],
  onOpenFolder,
}: {
  crumbs?: KnowledgeCrumb[];
  title: ReactNode;
  entries: KnowledgeEntry[];
  loading?: boolean;
  searchRoots: KnowledgeSearchRoot[];
  can: FilePermissions;
  // Opens the entry large in the page.
  onOpen: (entry: KnowledgeEntry) => void;
  onCreate?: (kind: KnowledgeCreation) => void;
  onUpload?: (files: File[]) => void;
  // The row's menu; `rename` starts renaming the row in place.
  menuFor?: (entry: KnowledgeEntry, helpers: { rename?: () => void }) => ReactNode;
  rowPropsFor?: (entry: KnowledgeEntry) => Record<string, unknown>;
  // Renaming in place (F2, the menu) and the trash (Entf) of the selected row (Auftrag 117).
  onRename?: (entry: KnowledgeEntry, name: string) => void;
  onTrash?: (entry: KnowledgeEntry) => void;
  more?: ReactNode;
  emptyText: string;
  // A folder shows everything ('all'); level 1 follows ?kind= (Wissen or Dateien).
  kind?: KnowledgeListKind;
  // A folder without files but with subfolders offers them in its empty state.
  subfolders?: { name: string; path: string; icon?: LucideIcon }[];
  onOpenFolder?: (path: string) => void;
}) {
  const t = useTranslations('files.knowledge');
  const tOrigin = useTranslations('files.origin');
  const relativeTime = useRelativeTime();
  const params = useSearchParams();
  const kind: KnowledgeListKind =
    forcedKind ?? (params?.get('kind') === 'files' ? 'files' : 'knowledge');
  const [origin, setOrigin] = useState<FileOrigin | 'all'>('all');
  const narrow = useMediaQuery('(max-width: 640px)');
  const [preview, setPreview] = useState<KnowledgeEntry | null>(null);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const create = (creation: KnowledgeCreation) => {
    if (creation === 'upload') upload.current?.click();
    else onCreate?.(creation);
  };
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
  const ofThisKind = entries.filter((entry) => ofKind(kind, entry.item));
  const shown = searching
    ? found
    : ofThisKind.filter((entry) => origin === 'all' || (entry.item.origin ?? 'manual') === origin);
  const selected = shown.find((entry) => entry.key === selectedKey) ?? shown[0];
  const selectedIndex = selected ? shown.indexOf(selected) : -1;
  const { ref: listRef, onKeyDown: onListKeyDown } = useListKeyboard({
    count: shown.length,
    selected: selectedIndex,
    onSelect: (index) => setSelectedKey(shown[index]?.key ?? null),
    onOpen: (index) => shown[index] && setPreview(shown[index]),
  });
  // F2 renames the selected row in place, Entf (or ⌘⌫) moves it to the trash.
  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (selected && can.edit && onRename && event.key === 'F2') {
      event.preventDefault();
      setRenamingKey(selected.key);
      return;
    }
    if (
      selected &&
      can.delete &&
      onTrash &&
      (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)))
    ) {
      event.preventDefault();
      onTrash(selected);
      return;
    }
    onListKeyDown(event);
  };
  const helpersFor = (entry: KnowledgeEntry) => ({
    rename: onRename && can.edit ? () => setRenamingKey(entry.key) : undefined,
  });
  const pending = searching ? hits.some((hit) => hit.isPending) : loading;
  // A note a view (.base) lists opens in the same place.
  const openVaultPath = (vaultPath: string) => {
    const base = preview ?? selected;
    if (!base) return;
    const root = rootOf(base.scope);
    if (!vaultPath.startsWith(`${root}/`)) return;
    const relative = vaultPath.slice(root.length + 1);
    setPreview({
      key: vaultPath,
      item: {
        name: relative.split('/').at(-1) ?? relative,
        path: relative,
        kind: 'file',
        contentType: null,
        sizeBytes: null,
        updatedAt: null,
      },
      scope: base.scope,
      vaultPath,
      projectKey: base.projectKey,
    });
  };

  const newMenu = can.create && onCreate && (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className={cn(PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS)}>
          <Plus aria-hidden="true" />
          {t('new')}
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-52">
        {creations
          .filter((creation) => creation !== 'upload' || onUpload)
          .map((creation) => {
            const Icon = creationIcons[creation];
            return (
              <MenuItem key={creation} onSelect={() => create(creation)}>
                <Icon />
                {t(`create.${creation}`)}
              </MenuItem>
            );
          })}
      </MenuContent>
    </Menu>
  );

  // In Home every file of a project carries its project, so it is clear where it lives.
  const where = (entry: KnowledgeEntry) =>
    entry.projectKey ? (
      <Inline gap={1}>
        <ProjectTag projectKey={entry.projectKey} />
        <Text truncate>{entry.location}</Text>
      </Inline>
    ) : (
      entry.location
    );

  // The empty list says what is missing and offers the one thing to do about it.
  const empty = searching ? (
    <EmptyState icon={<SearchX />}>{t('noResults')}</EmptyState>
  ) : origin !== 'all' && ofThisKind.length > 0 ? (
    <EmptyState icon={<FolderOpen />}>{t('emptyFilter')}</EmptyState>
  ) : subfolders.length > 0 && kind === 'all' ? (
    <EmptyState
      icon={<FolderOpen />}
      title={t('onlySubfoldersTitle')}
      action={
        <Inline gap={2} wrap justify="center">
          {subfolders.map((folder) => {
            const Icon = folder.icon ?? Folder;
            return (
              <Button
                key={folder.path}
                variant="quiet"
                icon={<Icon size={14} aria-hidden="true" />}
                onClick={() => onOpenFolder?.(folder.path)}
              >
                {folder.name}
              </Button>
            );
          })}
        </Inline>
      }
    >
      {t('onlySubfolders')}
    </EmptyState>
  ) : (
    <EmptyState
      icon={kind === 'files' ? <Paperclip /> : <FolderOpen />}
      title={kind === 'files' ? t('emptyFilesTitle') : t('emptyTitle')}
      action={
        can.create &&
        (kind === 'files' || !onCreate ? (
          onUpload && (
            <Button
              variant="primary"
              icon={<Upload size={15} aria-hidden="true" />}
              onClick={() => create('upload')}
            >
              {t('create.upload')}
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            icon={<FilePlus2 size={15} aria-hidden="true" />}
            onClick={() => create('doc')}
          >
            {t('create.firstDoc')}
          </Button>
        ))
      }
    >
      {emptyText}
    </EmptyState>
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
          !searching &&
          ofThisKind.length > 0 &&
          (narrow ? (
            // On a phone the four pills would push the search out: one select instead.
            <PageSelect<FileOrigin | 'all'>
              label={tOrigin('label')}
              icon={ListFilter}
              value={origin}
              defaultValue="all"
              onChange={setOrigin}
              options={ORIGINS.map((value) => ({ value, label: tOrigin(value) }))}
            />
          ) : (
            // The same segment control as every other view switch in the top bar (owner
            // 29.09.: Wissen looked different from Aufgaben).
            <Segmented<FileOrigin | 'all'>
              label={tOrigin('label')}
              value={origin}
              onChange={setOrigin}
              options={ORIGINS.map((value) => ({ value, label: tOrigin(value) }))}
            />
          ))
        }
        footer={
          can.create &&
          onUpload &&
          shown.length > 0 && (
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
        {!pending && shown.length > 0 && (
          <KnowledgeListHead
            name={t('columns.name')}
            kind={searching ? t('columns.match') : t('columns.kind')}
            trailing={t('columns.changed')}
          />
        )}
        {/* Arrow keys move through the rows; the rows themselves are buttons. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div ref={listRef} onKeyDown={onRowsKeyDown} className="ds-knowledge-rows">
          {pending ? (
            <EmptyState fill={false}>{searching ? t('searching') : t('loading')}</EmptyState>
          ) : shown.length === 0 ? (
            empty
          ) : (
            shown.map((entry, index) => {
              const entryKind = knowledgeKind(entry.item);
              const entryOrigin = entry.item.origin;
              const detail = searching ? (
                entry.location
              ) : (
                <Inline gap={2}>
                  <Text size="xs" tone="muted">
                    {t(`kinds.${entryKind}`)}
                  </Text>
                  {entry.location !== undefined && (
                    <>
                      <Text size="xs" tone="faint" aria-hidden="true">
                        {'·'}
                      </Text>
                      {where(entry)}
                    </>
                  )}
                </Inline>
              );
              return (
                <KnowledgeRow
                  key={entry.key}
                  index={index}
                  icon={knowledgeIcons[entryKind]}
                  name={
                    entryOrigin && entryOrigin !== 'manual' ? (
                      <Inline gap={2} as="span">
                        <Text truncate>{knowledgeDisplayName(entry.item.name)}</Text>
                        <OriginBadge origin={entryOrigin} />
                      </Inline>
                    ) : (
                      knowledgeDisplayName(entry.item.name)
                    )
                  }
                  title={entry.vaultPath ?? entry.item.name}
                  detail={detail}
                  trailing={entry.item.updatedAt ? relativeTime(entry.item.updatedAt) : '—'}
                  selected={selected?.key === entry.key}
                  onClick={() => {
                    setSelectedKey(entry.key);
                    setPreview(entry);
                  }}
                  onDoubleClick={() => {
                    setPreview(null);
                    onOpen(entry);
                  }}
                  menu={menuFor?.(entry, helpersFor(entry))}
                  rowProps={rowPropsFor?.(entry)}
                  renaming={
                    renamingKey === entry.key && onRename
                      ? {
                          initial: knowledgeDisplayName(entry.item.name),
                          label: t('renameLabel', { name: entry.item.name }),
                          onSubmit: (name) => {
                            setRenamingKey(null);
                            onRename(entry, name);
                          },
                          onCancel: () => setRenamingKey(null),
                        }
                      : undefined
                  }
                />
              );
            })
          )}
        </div>
      </KnowledgeFrame>
      {preview && (
        <KnowledgePreview
          key={preview.key}
          entry={preview}
          can={can}
          menu={menuFor?.(preview, {})}
          onClose={() => setPreview(null)}
          onOpenLarge={() => {
            const entry = preview;
            setPreview(null);
            onOpen(entry);
          }}
          onOpenEntry={openVaultPath}
        />
      )}
      {onUpload && (
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          data-knowledge-upload=""
          onChange={(event) => {
            onUpload(Array.from(event.target.files ?? []));
            event.currentTarget.value = '';
          }}
        />
      )}
    </>
  );
}
