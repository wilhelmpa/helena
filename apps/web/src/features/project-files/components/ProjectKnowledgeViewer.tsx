'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { FileCode2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, MenuItem, MonoLabel, Page, Pill, Text } from '@/design-system';
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
import { filesPath, vaultNotePath } from '@/utils/paths';
import type { FileActions } from '../hooks/useFileActions';
import FileItemMenu from './FileItemMenu';
import OriginBadge from './OriginBadge';
import VaultTextEditor from './VaultTextEditor';
import styles from './ProjectKnowledgeViewer.module.css';

// A Markdown file in the formatted editor, saved as it is typed (and on blur). Reports
// when the editor could not keep every construct of the file (`onLossless(false)`): the
// caller then shows the source editor instead.
export function MarkdownBody({
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
      <Text as="p" role="status" tone="muted">
        {t('loadingDoc')}
      </Text>
    );
  if (!query.data)
    return (
      <Text as="p" role="alert" tone="danger">
        {t('loadError')}
      </Text>
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
  const roots = useTranslations('files.roots');
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
  const title = note.data?.title || item.name.replace(/\.(md|markdown|pdf)$/i, '');
  const datedTitle = /^(.*?)\s+(\d{1,2}\.\s+.+)$/.exec(title);
  const tags = note.data ? noteTags(note.data.frontmatter) : [];
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
  // The path is the page's breadcrumb (O16); the file's actions sit on the right of the
  // header like every page's.
  const menu = (
    <FileItemMenu
      item={item}
      actions={actions}
      can={{ create: false, edit: canEdit, delete: canDelete }}
      size="default"
      extra={
        markdown &&
        !lossy && (
          <MenuItem onSelect={() => void changeSource(!sourceOnly)}>
            <FileCode2 />
            {sourceOnly ? k('editor') : k('source')}
          </MenuItem>
        )
      }
    />
  );
  const head: ReactNode = (
    <header className="ds-doc-head">
      <h2 className="ds-doc-title" dir="auto">
        {datedTitle ? (
          <>
            {datedTitle[1]}
            <br />
            {datedTitle[2]}
          </>
        ) : (
          title
        )}
      </h2>
      <div className="ds-doc-meta">
        <span className="ds-doc-dot" />
        {item.origin && item.origin !== 'manual' && <OriginBadge origin={item.origin} />}
        <span>
          {[
            references.data?.author || history.data?.[0]?.authorName || roots('vault'),
            item.updatedAt ? relativeTime(item.updatedAt) : k('unknownTime'),
            markdown && !source ? (dirty ? k('unsaved') : k('saved')) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="ds-doc-meta-fill" />
        {tags.map((tag) => (
          <Pill key={tag}>{`#${tag}`}</Pill>
        ))}
      </div>
    </header>
  );
  const details = (
    <>
      <Card title={<MonoLabel>{k('backlinks')}</MonoLabel>}>
        {backlinks.data?.length ? (
          backlinks.data.map((link) => (
            <button
              type="button"
              key={link.path}
              onClick={() => void openBacklink(backlinkHref(link.path))}
              className="ds-doc-backlink"
            >
              {link.title}
            </button>
          ))
        ) : (
          <Text as="p" size="xs" tone="muted">
            {k('noBacklinks')}
          </Text>
        )}
      </Card>
      <Card title={<MonoLabel>{k('history')}</MonoLabel>}>
        {history.data?.length ? (
          history.data.slice(0, 5).map((revision) => (
            <Text as="p" size="xs" tone="muted" key={revision.commit}>
              {`${relativeTime(revision.committedAt)} · ${revision.authorName}: ${revision.message}`}
            </Text>
          ))
        ) : (
          <Text as="p" size="xs" tone="muted">
            {k('noHistory')}
          </Text>
        )}
      </Card>
    </>
  );
  return (
    <Page variant="default" actions={menu}>
      <WebLinkScope projectKey={projectKey}>
        <div data-file-preview data-project-knowledge className="ds-doc-page">
          <article className="ds-doc-card">
            {head}
            <div className={`${styles.prose} ds-doc-body`}>
              {markdown ? (
                source ? (
                  // A file the formatted editor cannot keep opens in the source editor,
                  // without a note about it (owner, O15).
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
                    onLossless={onLossless}
                  />
                )
              ) : (
                <FileViewerContent file={file} />
              )}
            </div>
          </article>
          <aside className="ds-doc-aside" aria-label={k('details')}>
            {details}
          </aside>
        </div>
      </WebLinkScope>
    </Page>
  );
}
