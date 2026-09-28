'use client';
/* eslint-disable react/jsx-no-literals, no-restricted-syntax, better-tailwindcss/no-restricted-classes -- Maße und Texte aus WissenOrdner.dc.html. */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueries, useQuery } from '@tanstack/react-query';
import { FileImage, FileText, Folder, MoreHorizontal, Network, Search, Upload } from 'lucide-react';
import Modal from '@/components/common/overlay/Modal';
import DocumentTemplateDialog from '@/features/documents/components/DocumentTemplateDialog';
import DocumentTrashList from '@/features/documents/components/DocumentTrashList';
import { useOpenDailyNoteMutation } from '@/services/everything.service';
import { useProjectQuery } from '@/services/projects.service';
import { vaultNotePath } from '@/utils/paths';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { getVaultDocument, searchKnowledge } from '@/lib/api/endpoints/knowledge';
import {
  fileRawUrl,
  getFileReferences,
  listFiles,
  readFileText,
  type FileItem,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import type { FilePermissions } from './FileBrowser';
import FileItemMenu from './FileItemMenu';
import { compareKnowledgeFolders, knowledgeFolderLabel } from '@/utils/knowledgeFolders';

type Kind = 'Alles' | 'Dokumente' | 'Leinwände' | 'Dateien' | 'Von Agenten';
const pills: Kind[] = ['Alles', 'Dokumente', 'Leinwände', 'Dateien', 'Von Agenten'];
const creationKinds = ['Doc', 'Leinwand', 'Ordner', 'Datei hochladen'] as const;
const creationIcons = {
  Doc: FileText,
  Leinwand: Network,
  Ordner: Folder,
  'Datei hochladen': Upload,
};
const isDoc = (name: string) => /\.(md|markdown)$/i.test(name);
const isCanvas = (name: string) => /\.canvas$/i.test(name);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name);
const isPdf = (name: string) => /\.pdf$/i.test(name);

function Preview({
  item,
  scope,
  actions,
}: {
  item: FileItem;
  scope: FileScope;
  actions: FileActions;
}) {
  const vault = actions.vaultPath(item);
  const doc = useQuery({
    queryKey: ['knowledge-folder-preview', vault],
    queryFn: () => getVaultDocument(vault!),
    enabled: !!vault && isDoc(item.name),
  });
  const canvas = useQuery({
    queryKey: ['knowledge-canvas-preview', scope, item.path],
    queryFn: () => readFileText(scope, item.path),
    enabled: isCanvas(item.name),
  });
  let nodes: {
    id: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
  }[] = [];
  let edges: { fromNode: string; toNode: string }[] = [];
  if (canvas.data) {
    try {
      const parsed = JSON.parse(canvas.data.content) as {
        nodes?: typeof nodes;
        edges?: typeof edges;
      };
      nodes = parsed.nodes ?? [];
      edges = parsed.edges ?? [];
    } catch {
      /* malformed files show an empty thumbnail */
    }
  }
  const thumbnail = nodes.slice(0, 3);
  const minX = thumbnail.length ? Math.min(...thumbnail.map((node) => node.x)) : 0;
  const minY = thumbnail.length ? Math.min(...thumbnail.map((node) => node.y)) : 0;
  const maxX = Math.max(...thumbnail.map((node) => node.x + (node.width ?? 274)), 1);
  const maxY = Math.max(...thumbnail.map((node) => node.y + (node.height ?? 90)), 1);
  const scale = Math.min(0.42, 260 / (maxX - minX), 150 / (maxY - minY));
  const position = (node: (typeof thumbnail)[number]) => ({
    x: 18 + (node.x - minX) * scale,
    y: 24 + (node.y - minY) * scale,
    width: Math.min(105, (node.width ?? 274) * scale),
    height: Math.max(32, (node.height ?? 90) * scale),
  });
  return (
    <div className="relative h-[200px] overflow-hidden rounded-2xl bg-[#0e0d11] shadow-[0_0_0_1px_#ffffff0c]">
      {isImage(item.name) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileRawUrl(scope, item.path)} alt="" className="h-full w-full object-contain" />
      ) : isPdf(item.name) ? (
        <object
          data={`${fileRawUrl(scope, item.path)}#page=1&toolbar=0&navpanes=0`}
          type="application/pdf"
          aria-label={item.name}
          className="h-full w-full"
        />
      ) : isDoc(item.name) ? (
        <div className="overflow-hidden p-5 text-xs leading-6 whitespace-pre-wrap text-[#cfc6da]">
          {doc.data?.body.slice(0, 900)}
        </div>
      ) : isCanvas(item.name) ? (
        <div className="relative h-full w-full">
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 300 200">
            {edges.map((edge, index) => {
              const source = thumbnail.find((node) => node.id === edge.fromNode);
              const target = thumbnail.find((node) => node.id === edge.toNode);
              if (!source || !target) return null;
              const from = position(source);
              const to = position(target);
              const vertical = target.y > source.y + (source.height ?? 90) * 1.5;
              const sx = vertical ? from.x + from.width / 2 : from.x + from.width;
              const sy = vertical ? from.y + from.height : from.y + from.height / 2;
              const tx = vertical ? to.x + to.width / 2 : to.x;
              const ty = vertical ? to.y : to.y + to.height / 2;
              const d = vertical
                ? `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2} ${tx} ${(sy + ty) / 2} ${tx} ${ty}`
                : `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy} ${(sx + tx) / 2} ${ty} ${tx} ${ty}`;
              return <path key={index} d={d} fill="none" stroke="#8b859555" strokeWidth="1" />;
            })}
          </svg>
          {thumbnail.map((node) => (
            <div
              key={node.id}
              className="absolute max-w-[105px] truncate rounded-[10px] border border-[#bdaaff55] bg-[#141217] px-2 py-1.5 text-[10px] text-[#cfc6da]"
              style={{
                left: position(node).x,
                top: position(node).y,
                width: position(node).width,
              }}
            >
              {node.text?.split('\n')[0]?.replace(/^# /, '') || 'Karte'}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-full place-items-center">
          <FileText size={38} className="text-[#8b8595]" />
        </div>
      )}
    </div>
  );
}

export default function KnowledgeFolderView({
  scope,
  path,
  items,
  actions,
  can,
  drag,
  onOpen,
  onNewFile,
  onNewCanvas,
  onNewFolder,
  onUpload,
}: {
  scope: FileScope;
  path: string;
  items: FileItem[];
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  onOpen: (item: FileItem) => void;
  onNewFile: () => void;
  onNewCanvas: () => void;
  onNewFolder: () => void;
  onUpload: (files: File[]) => void;
}) {
  const fixed = useTranslations('files.fixedFolders');
  const [filter, setFilter] = useState<Kind>('Alles');
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const router = useRouter();
  const daily = useOpenDailyNoteMutation();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const create = (name: (typeof creationKinds)[number]) => {
    setMenuOpen(false);
    if (name === 'Doc') onNewFile();
    else if (name === 'Leinwand') onNewCanvas();
    else if (name === 'Ordner') onNewFolder();
    else upload.current?.click();
  };
  const relativeTime = useRelativeTime();
  const project = useProjectQuery(scope.kind === 'project' ? scope.projectKey : null);
  const authors = useQueries({
    queries: items.map((item) => ({
      queryKey: ['knowledge-author', scope, item.path],
      queryFn: () => getFileReferences(scope, item.path),
      enabled: filter === 'Von Agenten' && item.kind === 'file',
      retry: false,
    })),
  });
  const root =
    scope.kind === 'project'
      ? `Projects/${scope.projectKey}`
      : scope.root === 'home'
        ? 'Home'
        : scope.root === 'private'
          ? 'Private'
          : 'Templates';
  const search = useQuery({
    queryKey: ['knowledge-folder-search', root, query],
    queryFn: () => searchKnowledge(query, root, 50),
    enabled: query.trim().length > 0,
  });
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', focus, true);
    return () => window.removeEventListener('keydown', focus, true);
  }, []);
  const shown = items
    .filter((item, index) => {
      if (filter === 'Dokumente')
        return isDoc(item.name) || (item.kind === 'folder' && item.name === 'Docs');
      if (filter === 'Leinwände')
        return isCanvas(item.name) || (item.kind === 'folder' && item.name === 'Boards');
      if (filter === 'Dateien')
        return (
          (item.kind === 'folder' && item.name === 'Files') ||
          (item.kind === 'file' && !isDoc(item.name) && !isCanvas(item.name))
        );
      if (filter === 'Von Agenten') {
        return item.kind === 'file' && authors[index]?.data?.authorKind === 'agent';
      }
      return true;
    })
    .sort((a, b) => {
      const rank = (item: FileItem) =>
        item.kind === 'folder' ? 0 : isCanvas(item.name) ? 1 : isDoc(item.name) ? 2 : 3;
      return (
        (scope.kind === 'project' && !path && a.kind === 'folder' && b.kind === 'folder'
          ? compareKnowledgeFolders(a.name, b.name)
          : 0) ||
        rank(a) - rank(b) ||
        (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '') ||
        a.name.localeCompare(b.name, 'de')
      );
    });
  const selected =
    items.find((item) => item.path === selectedPath) ??
    shown.find((item) => item.kind === 'file') ??
    shown[0];
  const folderCount = useQuery({
    queryKey: ['knowledge-folder-count', scope, selected?.path],
    queryFn: () => listFiles(scope, selected!.path),
    enabled: selected?.kind === 'folder',
  });
  const label =
    scope.kind === 'project'
      ? project.data?.project.name || scope.projectKey
      : scope.root === 'home'
        ? 'Home'
        : scope.root === 'private'
          ? 'Privat'
          : 'Vorlagen';
  return (
    <div
      data-project-knowledge
      className="flex min-h-0 flex-1 gap-7 overflow-hidden bg-[#050507] ps-12 pe-9 pt-[26px] pb-6 text-[#eeeaf6] max-md:flex-col max-md:overflow-y-auto max-md:px-4"
    >
      <section className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-[10px] font-mono text-[10px] font-medium tracking-[.23em] text-[#7ee0b8] uppercase">
              {label} · WISSEN
            </p>
            <h1 className="m-0 text-[38px] leading-[1.04] font-[520] tracking-[-.05em]">
              {scope.kind === 'project' && path && !path.includes('/')
                ? knowledgeFolderLabel(path, fixed)
                : path.split('/').at(-1) || label}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex h-8 min-w-[220px] items-center gap-1.5 rounded-full bg-[#111014] px-3 text-xs text-[#8b8595] shadow-[inset_0_0_0_1px_#ffffff0c] max-sm:min-w-0">
              <Search size={13} />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="In Wissen suchen …"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#8b8595]"
              />
              <span className="font-mono text-[10px] text-[#6f687a]">⌘K</span>
            </label>
            {can.create && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="h-8 rounded-full bg-[#e7dbfa] px-3 text-xs font-medium text-[#201b29]"
                >
                  + Neu
                </button>
                {menuOpen && (
                  <div className="absolute inset-e-0 top-10 z-20 w-44 rounded-xl border border-[#ffffff16] bg-[#111014] p-1 shadow-xl">
                    {creationKinds.map((name) => {
                      const Icon = creationIcons[name];
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => create(name)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-xs hover:bg-[#26212d]"
                        >
                          <Icon size={15} strokeWidth={1.6} />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {scope.kind === 'home' && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Weitere Wissensaktionen"
                  onClick={() => setMoreOpen(!moreOpen)}
                  className="grid size-8 place-items-center rounded-full bg-[#111014] text-[#8b8595]"
                >
                  <MoreHorizontal size={17} />
                </button>
                {moreOpen && (
                  <div className="absolute inset-e-0 top-10 z-20 w-44 rounded-xl border border-[#ffffff16] bg-[#111014] p-1 shadow-xl">
                    {scope.root === 'home' && can.create && (
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          daily.mutate(undefined, {
                            onSuccess: (note) => router.push(vaultNotePath(note.path)),
                          });
                        }}
                        className="block w-full rounded-lg px-3 py-2 text-start text-xs hover:bg-[#26212d]"
                      >
                        Heute
                      </button>
                    )}
                    {can.create && (
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          setTemplateOpen(true);
                        }}
                        className="block w-full rounded-lg px-3 py-2 text-start text-xs hover:bg-[#26212d]"
                      >
                        Aus Vorlage
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        setTrashOpen(true);
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-start text-xs hover:bg-[#26212d]"
                    >
                      Papierkorb
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>
        <div className="flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <button
              key={pill}
              type="button"
              onClick={() => setFilter(pill)}
              className={`h-7 rounded-full px-3 text-xs ${filter === pill ? 'bg-[#26212d] text-[#f3edf9]' : 'bg-[#111014] text-[#8f879a]'}`}
            >
              {pill}
            </button>
          ))}
        </div>
        {query.trim() ? (
          <div className="space-y-1 overflow-y-auto">
            {search.isPending ? (
              <p className="text-xs text-[#88808f]">Suche …</p>
            ) : (
              search.data?.items.map((hit) => (
                <button
                  key={hit.path}
                  type="button"
                  onClick={() => {
                    const relative = hit.path.slice(root.length + 1);
                    onOpen({
                      name: relative.split('/').at(-1) ?? hit.title,
                      path: relative,
                      kind: 'file',
                      contentType: null,
                      sizeBytes: null,
                      updatedAt: null,
                    });
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-start hover:bg-[#26212d]"
                >
                  <span className="block text-[13px]">{hit.title}</span>
                  <span className="line-clamp-1 text-xs text-[#88808f]">{hit.snippet}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[28px_minmax(0,1fr)_190px_110px] gap-3 px-3.5 font-mono text-[10px] font-medium tracking-[.23em] text-[#6f687a] max-sm:grid-cols-[22px_minmax(0,1fr)]">
              <span />
              <span>NAME</span>
              <span className="max-sm:hidden">ART</span>
              <span className="text-end max-sm:hidden">GEÄNDERT</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {shown.map((item) => {
                const Icon =
                  item.kind === 'folder'
                    ? Folder
                    : isCanvas(item.name)
                      ? Network
                      : isImage(item.name)
                        ? FileImage
                        : FileText;
                const art =
                  item.kind === 'folder'
                    ? 'Ordner'
                    : isCanvas(item.name)
                      ? 'Leinwand'
                      : isDoc(item.name)
                        ? 'Doc'
                        : isPdf(item.name)
                          ? 'PDF'
                          : isImage(item.name)
                            ? 'Bild'
                            : 'Datei';
                return (
                  <div
                    key={item.path}
                    {...drag.source(item)}
                    {...(item.kind === 'folder' ? drag.target(item.path) : {})}
                    className={`group relative grid min-h-11 grid-cols-[28px_minmax(0,1fr)_190px_110px] items-center gap-3 rounded-xl px-3.5 max-sm:grid-cols-[22px_minmax(0,1fr)] ${selected?.path === item.path ? 'bg-[#26212d] shadow-[0_2px_6px_#0004,inset_0_1px_#ffffff0c]' : 'hover:bg-[#111014]'}`}
                  >
                    <Icon size={18} strokeWidth={1.6} className="text-[#8b8595]" />
                    <button
                      type="button"
                      onClick={() => setSelectedPath(item.path)}
                      onDoubleClick={() => onOpen(item)}
                      className="min-w-0 truncate text-start text-[13px]"
                    >
                      {item.kind === 'folder' && scope.kind === 'project' && !path
                        ? knowledgeFolderLabel(item.name, fixed)
                        : isDoc(item.name) || isCanvas(item.name)
                          ? item.name.replace(/\.(md|markdown|canvas)$/i, '')
                          : item.name}
                    </button>
                    <span className="truncate text-xs text-[#88808f] max-sm:hidden">{art}</span>
                    <span className="text-end font-mono text-[11px] text-[#6f687a] max-sm:hidden">
                      {item.updatedAt ? relativeTime(item.updatedAt) : '—'}
                    </span>
                    <span className="absolute inset-e-2 top-1 hidden group-focus-within:block group-hover:block">
                      <FileItemMenu item={item} actions={actions} can={can} />
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => upload.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onUpload(Array.from(event.dataTransfer.files));
              }}
              className="mt-auto flex min-h-16 items-center justify-center gap-1.5 rounded-2xl bg-[repeating-linear-gradient(135deg,#0a090d_0_10px,#0c0b0f_10px_20px)] text-xs text-[#6f687a] shadow-[inset_0_0_0_1px_#ffffff10]"
            >
              <Upload size={14} />
              Dateien hierher ziehen oder <span className="text-[#bdaaff]">auswählen</span>
            </button>
          </>
        )}
      </section>
      <aside className="flex w-[300px] shrink-0 flex-col gap-3.5 pt-1.5 max-md:w-full">
        <p className="m-0 font-mono text-[10px] font-medium tracking-[.23em] text-[#6f687a]">
          VORSCHAU
        </p>
        {selected && selected.kind === 'file' && (
          <>
            <Preview key={selected.path} item={selected} scope={scope} actions={actions} />
            <p className="m-0 text-base">{selected.name.replace(/\.(md|canvas)$/i, '')}</p>
            <p className="m-0 text-xs leading-5 text-[#88808f]">
              {isCanvas(selected.name)
                ? 'Leinwand'
                : isDoc(selected.name)
                  ? 'Doc'
                  : isPdf(selected.name)
                    ? 'PDF'
                    : isImage(selected.name)
                      ? 'Bild'
                      : 'Datei'}
            </p>
            <button
              type="button"
              onClick={() => onOpen(selected)}
              className="h-8 rounded-full bg-[#e7dbfa] text-xs font-medium text-[#201b29]"
            >
              Öffnen
            </button>
          </>
        )}
        {selected?.kind === 'folder' && (
          <div className="rounded-2xl bg-[#0e0d11] p-5 shadow-[0_0_0_1px_#ffffff0c]">
            <Folder size={22} strokeWidth={1.5} className="mb-4 text-[#8b8595]" />
            <p className="m-0 text-base text-[#eeeaf6]">
              {scope.kind === 'project' && !path
                ? knowledgeFolderLabel(selected.name, fixed)
                : selected.name}
            </p>
            <p className="mt-2 text-xs text-[#88808f]">
              {folderCount.data
                ? `${folderCount.data.items.length}${folderCount.data.truncated ? '+' : ''}`
                : '…'}{' '}
              Einträge
            </p>
            <p className="mt-1 text-xs text-[#88808f]">
              Zuletzt geändert: {selected.updatedAt ? relativeTime(selected.updatedAt) : '—'}
            </p>
            <button
              type="button"
              onClick={() => onOpen(selected)}
              className="mt-4 h-8 w-full rounded-full bg-[#e7dbfa] text-xs font-medium text-[#201b29]"
            >
              Öffnen
            </button>
          </div>
        )}
        {can.create && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="font-mono text-[10px] tracking-[.23em] text-[#6f687a]">NEU</p>
            {creationKinds.map((name) => {
              const Icon = creationIcons[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => create(name)}
                  className="flex min-h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-start text-[13px] text-[#cfc6da] hover:bg-[#111014]"
                >
                  <Icon size={16} strokeWidth={1.6} className="text-[#8b8595]" />
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </aside>
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
      {templateOpen && (
        <DocumentTemplateDialog
          folder={`${root}${path ? `/${path}` : ''}`}
          onCreated={(created) => router.push(vaultNotePath(created))}
          onClose={() => setTemplateOpen(false)}
        />
      )}
      {trashOpen && (
        <Modal title="Papierkorb" onClose={() => setTrashOpen(false)} wide>
          <DocumentTrashList root={root} canEdit={can.edit} />
        </Modal>
      )}
    </div>
  );
}
