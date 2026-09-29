'use client';
/* eslint-disable better-tailwindcss/no-restricted-classes -- Der freigegebene Wissen-Entwurf verlangt diese Schriftgrößen (Titel 44 px, Text 15 px). */

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
  FolderInput,
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
import { KnowledgeEyebrow, type KnowledgeCrumb } from '@/components/helena/KnowledgeFrame';
import { MonoLabel } from '@/components/helena/DashboardPrimitives';
import ResizableSidePanel from '@/components/helena/ResizableSidePanel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useProjectQuery } from '@/services/projects.service';
import { knowledgeFolderLabel } from '@/utils/knowledgeFolders';
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
import { filesPath, vaultNotePath } from '@/utils/paths';
import type { FileActions } from '../hooks/useFileActions';
import VaultTextEditor from './VaultTextEditor';
import styles from './ProjectKnowledgeViewer.module.css';

function MarkdownBody({
  path,
  editable,
  onDirty,
  onSaveReady,
  onLossless,
}: {
  path: string;
  editable: boolean;
  onDirty: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onLossless: (lossless: boolean) => void;
}) {
  const t = useTranslations('files.knowledge');
  const query = useVaultNoteQuery(path);
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loadingDoc')}
      </p>
    );
  if (!query.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadError')}
      </p>
    );
  return (
    <MarkdownEditor
      key={query.data.path}
      document={query.data}
      editable={editable}
      onDirty={onDirty}
      onSaveReady={onSaveReady}
      onLossless={onLossless}
    />
  );
}

function MarkdownEditor({
  document,
  editable,
  onDirty,
  onSaveReady,
  onLossless,
}: {
  document: NonNullable<ReturnType<typeof useVaultNoteQuery>['data']>;
  editable: boolean;
  onDirty: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onLossless: (lossless: boolean) => void;
}) {
  const t = useTranslations('files.knowledge');
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
      if (!result.path) return void toast(t('linkNotFound'));
      const parts = result.path.split('/');
      if (parts[0] === 'Projects' && parts[1]) {
        const relative = parts.slice(2).join('/');
        router.push(filesPath(parts[1], parts.slice(2, -1).join('/'), { file: relative }));
      } else if (/\.md$/i.test(result.path)) void openWikilink(inner);
      else window.open(vaultFileUrl(result.path), '_blank', 'noopener');
    } catch {
      toast.error(t('linkFailed'));
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
      onLossless={(value) => {
        setLossless(value);
        onLossless(value);
      }}
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
  const k = useTranslations('files.knowledge');
  const fixed = useTranslations('files.fixedFolders');
  const roots = useTranslations('files.roots');
  const unified = useTranslations('files.unified');
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  // The formatted editor cannot keep every Markdown construct: such a file opens in the
  // source editor straight away, editable, instead of a formatted read-only view.
  const [lossy, setLossy] = useState(false);
  const source = sourceOnly || lossy;
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
  const onLossless = useCallback((lossless: boolean) => setLossy(!lossless), []);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!source) return;
    const guard = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest('a[href]');
      if (!anchor || anchor.closest('[data-file-preview]') || !dirtyRef.current) return;
      if (window.confirm(k('discard'))) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [source, k]);
  const t = useTranslations('files.actions');
  const canonical = actions.vaultPath(item) ?? '';
  const markdown = /\.md$/i.test(item.name);
  const note = useVaultNoteQuery(markdown ? canonical : null);
  const backlinks = useBacklinksQuery(canonical);
  const history = useNoteHistoryQuery(canonical, !!canonical);
  const project = useProjectQuery(scope.kind === 'project' ? scope.projectKey : null);
  const references = useQuery({
    queryKey: [...filesScopeKey(scope), 'references', path],
    queryFn: () => getFileReferences(scope, path),
    retry: false,
  });
  const title = note.data?.title || item.name.replace(/\.(md|markdown|pdf)$/i, '');
  const datedTitle = /^(.*?)\s+(\d{1,2}\.\s+.+)$/.exec(title);
  const tags = note.data ? noteTags(note.data.frontmatter) : [];
  const code = actions.codeUrl(item);
  const changeSource = async (next: boolean) => {
    if (next && saveRef.current && !(await saveRef.current())) return;
    if (!next && dirtyRef.current && !window.confirm(k('discard'))) return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('source', '1');
    else url.searchParams.delete('source');
    router.push(url.pathname + url.search);
  };
  const openBacklink = async (href: string) => {
    if (source && dirtyRef.current && !window.confirm(k('discard'))) return;
    if (saveRef.current && !(await saveRef.current())) return;
    router.push(href);
  };
  const backlinkHref = (linkedPath: string) => {
    const parts = linkedPath.split('/');
    return parts[0] === 'Projects' && parts[1]
      ? filesPath(parts[1], parts.slice(2, -1).join('/'), { file: parts.slice(2).join('/') })
      : vaultNotePath(linkedPath);
  };
  const projectKey = scope.kind === 'project' ? scope.projectKey : null;
  const wide = useMediaQuery('(min-width: 1024px)');
  const folder = (target: string): FileItem => ({
    name: target.split('/').at(-1) ?? target,
    path: target,
    kind: 'folder',
    contentType: null,
    sizeBytes: null,
    updatedAt: null,
  });
  const segments = path.split('/').slice(0, -1);
  // The same path eyebrow as the folder list: project · Wissen / folder / …, each a link.
  const crumbs: KnowledgeCrumb[] = [
    {
      label:
        scope.kind === 'project'
          ? project.data?.project.name || scope.projectKey
          : roots(scope.root),
    },
    { label: roots('vault'), onSelect: () => actions.open(folder('')) },
    ...segments.map((segment, index) => ({
      label:
        scope.kind === 'project' && index === 0 ? knowledgeFolderLabel(segment, fixed) : segment,
      onSelect: () => actions.open(folder(segments.slice(0, index + 1).join('/'))),
    })),
  ];
  const head: ReactNode = (
    <>
      <div className="flex items-center justify-between gap-3">
        <KnowledgeEyebrow crumbs={crumbs} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('more', { name: item.name })}
              className="size-9 shrink-0 rounded-full border border-input bg-card text-muted-foreground"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {markdown && !lossy && (
              <DropdownMenuItem onSelect={() => void changeSource(!sourceOnly)}>
                <FileCode2 />
                {sourceOnly ? k('editor') : k('source')}
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
              {k('copyLink')}
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
            {canEdit && (
              <DropdownMenuItem onSelect={() => actions.ask('move', item)}>
                <FolderInput />
                {t('move')}
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
        className="mt-[22px] mb-3 text-[44px] leading-[1.06] font-[520] tracking-[-.055em] break-words text-foreground max-sm:text-[34px]"
        dir="auto"
      >
        {datedTitle ? (
          <>
            {datedTitle[1]}
            <br />
            {datedTitle[2]}
          </>
        ) : (
          title
        )}
      </h1>
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <span className="size-[7px] rounded-full bg-brand" />
        <span>
          {[
            references.data?.author || history.data?.[0]?.authorName || roots('vault'),
            item.updatedAt ? relativeTime(item.updatedAt) : k('unknownTime'),
            markdown && !source ? (dirty ? k('unsaved') : k('saved')) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="grow" />
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2.5 py-[3px] text-xs text-foreground/80"
          >
            {`#${tag}`}
          </span>
        ))}
      </div>
    </>
  );
  const details = (
    <>
      <section className="flex flex-col gap-2">
        <MonoLabel>{k('backlinks')}</MonoLabel>
        {backlinks.data?.length ? (
          backlinks.data.map((link) => (
            <button
              type="button"
              key={link.path}
              onClick={() => void openBacklink(backlinkHref(link.path))}
              className="block w-full rounded-lg bg-card px-3 py-2.5 text-start text-xs text-foreground/85 hover:bg-muted"
            >
              {link.title}
            </button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{k('noBacklinks')}</p>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <MonoLabel>{k('history')}</MonoLabel>
        {history.data?.length ? (
          history.data.slice(0, 5).map((revision) => (
            <p key={revision.commit} className="text-xs leading-[1.7] text-muted-foreground">
              {`${relativeTime(revision.committedAt)} · ${revision.authorName}: ${revision.message}`}
            </p>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{k('noHistory')}</p>
        )}
      </section>
    </>
  );
  return (
    <WebLinkScope projectKey={projectKey}>
      <div
        data-file-preview
        data-project-knowledge
        className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-9 ps-16 pt-[26px] pb-6 max-lg:ps-9 max-md:px-5 max-sm:px-4">
          <article className="w-full max-w-[740px] min-w-0">
            {head}
            <div
              className={`${styles.prose} mt-[30px] text-[15px] leading-[1.75] text-foreground/90`}
            >
              {markdown ? (
                source ? (
                  <>
                    {lossy && !sourceOnly && (
                      <p
                        role="note"
                        className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
                      >
                        {unified('sourceRequired')}
                      </p>
                    )}
                    <VaultTextEditor
                      scope={scope}
                      path={path}
                      canEdit={canEdit}
                      onDirty={reportDirty}
                      vaultPath={canonical}
                      beforeNavigate={() => true}
                      sourceOnly
                    />
                  </>
                ) : (
                  <MarkdownBody
                    path={canonical}
                    editable={canEdit}
                    onDirty={reportDirty}
                    onSaveReady={onSaveReady}
                    onLossless={onLossless}
                  />
                )
              ) : (
                <FileViewerContent file={file} />
              )}
            </div>
          </article>
          {!wide && (
            <aside className="mt-10 flex max-w-[740px] flex-col gap-[22px] border-t border-border pt-6">
              {details}
            </aside>
          )}
        </div>
        {wide && (
          <ResizableSidePanel label={k('details')} reserve={520}>
            <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto ps-6 pe-9 pt-[84px] pb-6">
              {details}
            </div>
          </ResizableSidePanel>
        )}
      </div>
    </WebLinkScope>
  );
}
