'use client';
/* eslint-disable no-restricted-syntax, better-tailwindcss/no-restricted-classes, react/jsx-no-literals -- Der freigegebene Wissen-Entwurf verlangt genau diese Farben, Maße und Texte. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import {
  Download,
  Code2,
  ClipboardCopy,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileCode2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import FileViewerContent from '@/components/common/files/FileViewerContent';
import type { ViewerFile } from '@/components/common/files/FileViewer';
import WebLinkScope from '@/components/common/WebLinkScope';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { getFileReferences, type FileItem, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { filesScopeKey } from '@/services/files.service';
import {
  useBacklinksQuery,
  useNoteHistoryQuery,
  useVaultNoteQuery,
} from '@/features/documents/services/knowledge.service';
import { useNoteDraft } from '@/features/documents/hooks/useNoteDraft';
import DocumentEditorCanvas from '@/features/documents/components/DocumentEditorCanvas';
import { noteTags } from '@/features/documents/utils/noteFrontmatter';
import { useVaultWikilinkOpener } from '@/hooks/useVaultWikilinkOpener';
import { resolveWikilink, vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { parseWikilink, wikilinkTask } from '@/utils/wikilink';
import { filesPath } from '@/utils/paths';
import type { FileActions } from '../hooks/useFileActions';
import VaultTextEditor from './VaultTextEditor';
import styles from './ProjectKnowledgeViewer.module.css';

const mono = "font-['JetBrains_Mono',ui-monospace,monospace]";

function MarkdownBody({
  path,
  editable,
  onDirty,
  onSaveReady,
}: {
  path: string;
  editable: boolean;
  onDirty: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
}) {
  const query = useVaultNoteQuery(path);
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-[#88808f]">
        Dokument wird geladen …
      </p>
    );
  if (!query.data)
    return (
      <p role="alert" className="text-sm text-[#f4a3bf]">
        Dokument konnte nicht geladen werden.
      </p>
    );
  return (
    <MarkdownEditor
      key={query.data.path}
      document={query.data}
      editable={editable}
      onDirty={onDirty}
      onSaveReady={onSaveReady}
    />
  );
}

function MarkdownEditor({
  document,
  editable,
  onDirty,
  onSaveReady,
}: {
  document: NonNullable<ReturnType<typeof useVaultNoteQuery>['data']>;
  editable: boolean;
  onDirty: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
}) {
  const note = useNoteDraft(document);
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [lossless, setLossless] = useState(false);
  const openWikilink = useVaultWikilinkOpener(document.path);
  const openInlineLink = async (inner: string) => {
    if (note.dirty && !(await note.save())) return;
    const task = wikilinkTask(inner);
    if (task) return router.push(`/${task}`);
    const { target } = parseWikilink(inner);
    if (!target) return;
    try {
      const result = await resolveWikilink(document.path, target);
      if (!result.path) return void toast('Verknüpfung nicht gefunden');
      const parts = result.path.split('/');
      if (parts[0] === 'Projects' && parts[1] === document.projectKey) {
        const relative = parts.slice(2).join('/');
        router.push(filesPath(parts[1], parts.slice(2, -1).join('/'), { file: relative }));
      } else if (/\.md$/i.test(result.path)) void openWikilink(inner);
      else window.open(vaultFileUrl(result.path), '_blank', 'noopener');
    } catch {
      toast.error('Verknüpfung konnte nicht geöffnet werden');
    }
  };
  useEffect(() => onDirty(note.dirty), [note.dirty, onDirty]);
  useEffect(() => {
    onSaveReady(note.save);
    return () => onSaveReady(null);
  }, [note.save, onSaveReady]);
  return (
    <DocumentEditorCanvas
      embedded
      path={document.path}
      updatedAt={document.updatedAt}
      truncated={document.truncated}
      loaded={note.draft.loaded}
      editor={editor}
      editable={editable && !document.truncated && lossless}
      canRename={false}
      focusTitle={false}
      onEditorReady={setEditor}
      onLoaded={note.ready}
      onLossless={setLossless}
      onEdit={note.edit}
      onBlur={() => void note.save()}
      onRename={async () => {}}
      onOpenWikilink={(inner) => void openInlineLink(inner)}
    />
  );
}

export default function ProjectKnowledgeViewer({
  file,
  item,
  scope,
  path,
  canEdit,
  canDelete,
  sourceOnly,
  actions,
  onDirty,
}: {
  file: ViewerFile;
  item: FileItem;
  scope: FileScope;
  path: string;
  canEdit: boolean;
  canDelete: boolean;
  sourceOnly: boolean;
  actions: FileActions;
  onDirty: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const relativeTime = useRelativeTime();
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const reportDirty = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty;
      setDirty(dirty);
      onDirty(dirty);
    },
    [onDirty],
  );
  const onSaveReady = useCallback((save: (() => Promise<boolean>) | null) => {
    saveRef.current = save;
  }, []);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!sourceOnly) return;
    const guard = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest('a[href]');
      if (!anchor || anchor.closest('[data-file-preview]') || !dirtyRef.current) return;
      if (window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [sourceOnly]);
  const t = useTranslations('files.actions');
  const canonical = actions.vaultPath(item) ?? '';
  const markdown = /\.md$/i.test(item.name);
  const note = useVaultNoteQuery(markdown ? canonical : null);
  const backlinks = useBacklinksQuery(canonical);
  const history = useNoteHistoryQuery(canonical, !!canonical);
  const references = useQuery({
    queryKey: [...filesScopeKey(scope), 'references', path],
    queryFn: () => getFileReferences(scope, path),
    retry: false,
  });
  const title = item.name.replace(/\.(md|markdown|pdf)$/i, '');
  const tags = note.data ? noteTags(note.data.frontmatter) : [];
  const code = actions.codeUrl(item);
  const changeSource = async (source: boolean) => {
    if (source && saveRef.current && !(await saveRef.current())) return;
    if (!source && dirtyRef.current && !window.confirm('Ungespeicherte Änderungen verwerfen?'))
      return;
    const url = new URL(window.location.href);
    if (source) url.searchParams.set('source', '1');
    else url.searchParams.delete('source');
    router.push(url.pathname + url.search);
  };
  const openBacklink = async (href: string) => {
    if (sourceOnly && dirtyRef.current && !window.confirm('Ungespeicherte Änderungen verwerfen?'))
      return;
    if (saveRef.current && !(await saveRef.current())) return;
    router.push(href);
  };
  const projectKey = scope.kind === 'project' ? scope.projectKey : null;
  const head: ReactNode = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p
          className={`${mono} min-w-0 truncate text-[10px] font-medium tracking-[.23em] text-[#7ee0b8] uppercase`}
        >
          WISSEN / {path.split('/').slice(0, -1).join(' / ') || 'DATEIEN'}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('more', { name: item.name })}
              className="size-9 shrink-0 rounded-full border border-[#ffffff12] bg-[#0e0d11] text-[#96919f]"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {markdown && (
              <DropdownMenuItem onSelect={() => void changeSource(!sourceOnly)}>
                <FileCode2 />
                {sourceOnly ? 'Editor' : 'Quelltext'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <a href={actions.downloadUrl(item)} download={item.name}>
                <Download />
                {t('download')}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.copyPath(item)}>
              <ClipboardCopy />
              Link kopieren
            </DropdownMenuItem>
            {projectKey && (
              <DropdownMenuItem onSelect={() => actions.ask('link', item)}>
                <Link2 />
                {t('linkToTask')}
              </DropdownMenuItem>
            )}
            {code && (
              <DropdownMenuItem asChild>
                <a href={code} target="_blank" rel="noopener noreferrer">
                  <Code2 />
                  {t('openInCode')}
                </a>
              </DropdownMenuItem>
            )}
            {(canEdit || canDelete) && <DropdownMenuSeparator />}
            {canEdit && (
              <DropdownMenuItem onSelect={() => actions.ask('rename', item)}>
                <Pencil />
                {t('rename')}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onSelect={() => actions.ask('trash', item)}>
                <Trash2 />
                {t('trash')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <h1
        className="mt-[22px] mb-3 max-w-[540px] text-[44px] leading-[1.06] font-[520] tracking-[-.055em] text-[#eeeaf6] max-sm:text-[34px]"
        dir="auto"
      >
        {title}
      </h1>
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#88808f]">
        <span className="size-[7px] rounded-full bg-[#bdaaff]" />
        <span>
          {references.data?.author || history.data?.[0]?.authorName || 'Wissen'} ·{' '}
          {item.updatedAt ? relativeTime(item.updatedAt) : 'unbekannt'}
          {markdown && !sourceOnly ? (dirty ? ' · ungespeichert' : ' · gespeichert') : ''}
        </span>
        <span className="grow" />
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-[#111014] px-2.5 py-[3px] text-[11px] text-[#cfc6da]"
          >
            #{tag}
          </span>
        ))}
      </div>
    </>
  );
  return (
    <WebLinkScope projectKey={projectKey}>
      <div
        data-file-preview
        className="flex min-h-0 min-w-0 flex-1 gap-10 overflow-y-auto px-9 ps-16 pt-[26px] pb-6 max-lg:gap-6 max-md:px-5 max-sm:px-4"
      >
        <article className="max-w-[740px] min-w-0 flex-1">
          {head}
          <div className={`${styles.prose} mt-[30px] text-[15px] leading-[1.75] text-[#d9d3e3]`}>
            {markdown ? (
              sourceOnly ? (
                <VaultTextEditor
                  scope={scope}
                  path={path}
                  canEdit={canEdit}
                  onDirty={reportDirty}
                  vaultPath={canonical}
                  beforeNavigate={() => true}
                  sourceOnly
                />
              ) : (
                <MarkdownBody
                  path={canonical}
                  editable={canEdit}
                  onDirty={reportDirty}
                  onSaveReady={onSaveReady}
                />
              )
            ) : (
              <FileViewerContent file={file} />
            )}
          </div>
        </article>
        <aside className="w-[250px] shrink-0 space-y-[22px] pt-[58px] max-lg:w-[190px] max-md:hidden">
          <section className="space-y-2">
            <h2 className={`${mono} text-[10px] font-medium tracking-[.23em] text-[#6f687a]`}>
              VERWEISE HIERHER
            </h2>
            {backlinks.data?.length ? (
              backlinks.data.map((link) => (
                <button
                  type="button"
                  key={link.path}
                  onClick={() =>
                    projectKey &&
                    void openBacklink(
                      filesPath(projectKey, link.path.split('/').slice(2, -1).join('/'), {
                        file: link.path.split('/').slice(2).join('/'),
                      }),
                    )
                  }
                  className="block w-full rounded-xl bg-[#0e0d11] px-3 py-2.5 text-start text-xs text-[#cfc6da]"
                >
                  {link.title}
                </button>
              ))
            ) : (
              <p className="text-xs text-[#88808f]">Keine Verweise</p>
            )}
          </section>
          <section className="space-y-2">
            <h2 className={`${mono} text-[10px] font-medium tracking-[.23em] text-[#6f687a]`}>
              VERLAUF
            </h2>
            {history.data?.length ? (
              history.data.slice(0, 5).map((revision) => (
                <p key={revision.commit} className="text-xs leading-[1.7] text-[#88808f]">
                  {new Date(revision.committedAt).toLocaleString('de-DE', {
                    day: 'numeric',
                    month: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  {revision.authorName}: {revision.message}
                </p>
              ))
            ) : (
              <p className="text-xs text-[#88808f]">Noch kein Verlauf</p>
            )}
          </section>
        </aside>
      </div>
    </WebLinkScope>
  );
}
