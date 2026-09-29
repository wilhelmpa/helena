'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Inline, Overlay, Segmented, Stack, Text } from '@/design-system';
import FileViewerContent from '@/components/common/files/FileViewerContent';
import WebLinkScope from '@/components/common/WebLinkScope';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { fileRawUrl } from '@/lib/api/endpoints/projectFiles';
import { isBase, isCanvas, isDoc, knowledgeDisplayName } from '../utils/knowledgeKinds';
import type { FilePermissions } from './FileBrowser';
import type { KnowledgeEntry } from './KnowledgeListView';
import KnowledgeBaseView from './KnowledgeBaseView';
import KnowledgeCanvas from './KnowledgeCanvas';
import FolderMark from './FolderMark';
import OriginBadge from './OriginBadge';
import { MarkdownBody } from './ProjectKnowledgeViewer';
import VaultTextEditor from './VaultTextEditor';
import { unpinOverlay, useOverlayShownHere, type OverlayPin } from '@/utils/overlayPin';
import { FileOverlayCtx } from '../hooks/fileOverlayContext';
import { fileViewKind } from '@/utils/fileKinds';

// A file of Wissen opened on the right, in the one overlay (owner 29.09., O49): a doc in
// its editor, a canvas, a view (.base), a text, a table, a PDF, an image, any other file in
// its viewer. Under the head stand the file's actions with their names (O80, `actionBar`),
// then the file itself on one surface (O75). Full screen makes the overlay large and small
// again; "Als Seite öffnen" opens the file large in the page. A doc is saved before either.
export default function KnowledgePreview({
  entry,
  can,
  actionBar,
  onClose,
  onOpenLarge,
  onOpenEntry,
  pinnedHost = false,
}: {
  entry: KnowledgeEntry;
  can: FilePermissions;
  // The file's actions as named buttons (FileActionBar), built by the page that has the
  // dialogs behind them.
  actionBar?: ReactNode;
  onClose: () => void;
  onOpenLarge: () => void;
  // A note a view (.base) lists, opened in its place.
  onOpenEntry?: (vaultPath: string) => void;
  // Shown by the Shell because it is pinned (PinnedKnowledgePreview), not by a Wissen page.
  pinnedHost?: boolean;
}) {
  const t = useTranslations('files.knowledge');
  const unified = useTranslations('files.unified');
  const relativeTime = useRelativeTime();
  const { item, scope } = entry;
  const name = knowledgeDisplayName(item.name);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const dirtyRef = useRef(false);
  // A doc opens formatted; the source is a switch. One the formatted editor cannot keep
  // exactly opens as source straight away.
  const [source, setSource] = useState(false);
  const [lossy, setLossy] = useState(false);
  const onSaveReady = useCallback((save: (() => Promise<boolean>) | null) => {
    saveRef.current = save;
  }, []);
  const onDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const onLossless = useCallback((lossless: boolean) => setLossy(!lossless), []);
  // Leaving saves the doc; unsaved source text asks first.
  const leave = async (then: () => void) => {
    if (saveRef.current && !(await saveRef.current())) return;
    if (!saveRef.current && dirtyRef.current && !window.confirm(t('discard'))) return;
    then();
  };
  // The switch between the formatted text and its source: the doc is saved on the way
  // over, unsaved source text asks first.
  const showSource = async (next: boolean) => {
    if (next === source && !lossy) return;
    if (next) {
      if (saveRef.current && !(await saveRef.current())) return;
    } else if (dirtyRef.current && !window.confirm(t('discard'))) return;
    dirtyRef.current = false;
    setLossy(false);
    setSource(next);
  };
  // Pinned, the file stays open on other pages (Auftrag 117); the entry comes along.
  const pin: OverlayPin = {
    kind: 'file',
    value: entry.key,
    data: JSON.stringify({ entry, can }),
  };
  useOverlayShownHere(pinnedHost ? null : pin);
  const doc = isDoc(item.name);
  const vaultPath = entry.vaultPath;
  const viewKind = fileViewKind(item.name, item.contentType);
  // Text that is written, not code: Markdown and plain text open in the Markdown editor.
  const written = viewKind === 'markdown' || /\.txt$/i.test(item.name);
  const asSource = source || lossy;

  let body: ReactNode;
  if (doc && vaultPath) {
    body = (
      <Stack gap={2} className="ds-knowledge-editor">
        <Segmented
          className="self-start"
          label={t('editor')}
          value={asSource ? 'source' : 'formatted'}
          onChange={(next) => void showSource(next === 'source')}
          options={[
            { value: 'formatted', label: unified('formatted') },
            { value: 'source', label: unified('source') },
          ]}
        />
        {asSource ? (
          <VaultTextEditor
            scope={scope}
            path={item.path}
            canEdit={can.edit}
            onDirty={onDirty}
            vaultPath={vaultPath}
            beforeNavigate={() => true}
            sourceOnly
          />
        ) : (
          <MarkdownBody
            path={vaultPath}
            editable={can.edit}
            onDirty={onDirty}
            onSaveReady={onSaveReady}
            onLossless={onLossless}
          />
        )}
      </Stack>
    );
  } else if (isCanvas(item.name)) {
    body = (
      <KnowledgeCanvas
        scope={scope}
        path={item.path}
        name={item.name}
        editable={can.edit}
        item={item}
        can={can}
        compact
      />
    );
  } else if (isBase(item.name) && vaultPath) {
    body = <KnowledgeBaseView path={vaultPath} compact onOpenNote={onOpenEntry} />;
  } else if (written && vaultPath) {
    // Plain text: the same editor, formatted first, with the source one click away.
    body = (
      <VaultTextEditor
        scope={scope}
        path={item.path}
        canEdit={can.edit}
        onDirty={onDirty}
        vaultPath={vaultPath}
        beforeNavigate={() => true}
      />
    );
  } else {
    body = (
      <FileViewerContent
        file={{
          name: item.name,
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
          url: fileRawUrl(scope, item.path),
          vaultPath,
        }}
      />
    );
  }

  const dismiss = () =>
    void leave(() => {
      unpinOverlay(pin);
      onClose();
    });
  return (
    <FileOverlayCtx.Provider value={{ dismiss }}>
      <Overlay
        label={name}
        tabs={[{ id: 'file', label: name }]}
        onClose={() => void leave(onClose)}
        onOpenPage={() => void leave(onOpenLarge)}
        pin={pin}
        className="ds-file-overlay"
        bodyClassName="ds-knowledge-preview"
      >
        <WebLinkScope projectKey={scope.kind === 'project' ? scope.projectKey : null}>
          <Stack gap={3} className="ds-knowledge-preview-body" data-knowledge-preview={item.path}>
            <Inline gap={2} wrap>
              {item.origin && item.origin !== 'manual' && <OriginBadge origin={item.origin} />}
              <FolderMark entry={entry} />
              <Text size="xs" tone="muted">
                {[entry.location, item.updatedAt ? relativeTime(item.updatedAt) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Inline>
            {actionBar}
            {body}
          </Stack>
        </WebLinkScope>
      </Overlay>
    </FileOverlayCtx.Provider>
  );
}
