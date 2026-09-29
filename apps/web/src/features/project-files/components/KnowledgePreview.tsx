'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Inline, Overlay, Stack, Text } from '@/design-system';
import FileViewerContent from '@/components/common/files/FileViewerContent';
import WebLinkScope from '@/components/common/WebLinkScope';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { fileRawUrl } from '@/lib/api/endpoints/projectFiles';
import { isBase, isCanvas, isDoc, knowledgeDisplayName } from '../utils/knowledgeKinds';
import type { FilePermissions } from './FileBrowser';
import type { KnowledgeEntry } from './KnowledgeListView';
import KnowledgeBaseView from './KnowledgeBaseView';
import KnowledgeCanvas from './KnowledgeCanvas';
import OriginBadge from './OriginBadge';
import { MarkdownBody } from './ProjectKnowledgeViewer';
import VaultTextEditor from './VaultTextEditor';

// A file of Wissen opened on the right, in the one overlay (owner 29.09., O49): a doc in
// its editor, a canvas, a view (.base), a PDF, an image, any other file in its viewer. The
// overlay's full-screen button opens it large in the page instead; Esc closes it. A doc
// is saved before either happens.
export default function KnowledgePreview({
  entry,
  can,
  menu,
  onClose,
  onOpenLarge,
  onOpenEntry,
}: {
  entry: KnowledgeEntry;
  can: FilePermissions;
  menu?: ReactNode;
  onClose: () => void;
  onOpenLarge: () => void;
  // A note a view (.base) lists, opened in its place.
  onOpenEntry?: (vaultPath: string) => void;
}) {
  const t = useTranslations('files.knowledge');
  const relativeTime = useRelativeTime();
  const { item, scope } = entry;
  const name = knowledgeDisplayName(item.name);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const dirtyRef = useRef(false);
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
  const doc = isDoc(item.name);
  const vaultPath = entry.vaultPath;

  let body: ReactNode;
  if (doc && vaultPath) {
    body = lossy ? (
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

  return (
    <Overlay
      label={name}
      tabs={[{ id: 'file', label: name }]}
      actions={menu}
      onClose={() => void leave(onClose)}
      onFullscreen={() => void leave(onOpenLarge)}
      className="ds-file-overlay"
      bodyClassName="ds-knowledge-preview"
    >
      <WebLinkScope projectKey={scope.kind === 'project' ? scope.projectKey : null}>
        <Stack gap={3} className="ds-knowledge-preview-body" data-knowledge-preview={item.path}>
          <Inline gap={2} wrap>
            {item.origin && item.origin !== 'manual' && <OriginBadge origin={item.origin} />}
            <Text size="xs" tone="muted">
              {[entry.location, item.updatedAt ? relativeTime(item.updatedAt) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Inline>
          {body}
        </Stack>
      </WebLinkScope>
    </Overlay>
  );
}
