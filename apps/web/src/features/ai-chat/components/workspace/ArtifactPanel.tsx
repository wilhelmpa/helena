'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { ActionMenu, Overlay, OverlayHead } from '@/design-system';
import { copyText } from '@/utils/clipboard';
import { createTextFile } from '@/lib/api/endpoints/projectFiles';
import { chatUploadScope } from '../../hooks/useVaultUpload';
import { artifactFileName, type Artifact } from '../../utils/artifacts';
import ArtifactCodeView from './ArtifactCodeView';
import ArtifactPreviewFrame from './ArtifactPreviewFrame';

export interface ArtifactPanelProps {
  artifact: Artifact | null;
  open: boolean;
  onClose: () => void;
  overlay: boolean;
  scopeKey: string;
}

// The artifact panel: a code view with syntax highlighting and copy, and a live
// preview in a sandboxed iframe with no access to the app's origin (see
// utils/artifacts.ts — allow-scripts, no allow-same-origin, and a strict CSP). A
// sibling column wide enough (with the same head as every overlay), the one overlay below it, so opening one never pushes
// the conversation to an unreadable width.
export default function ArtifactPanel({
  artifact,
  open,
  onClose,
  overlay,
  scopeKey,
}: ArtifactPanelProps) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const [tab, setTab] = useState<'code' | 'preview'>('preview');
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (!artifact) return;
      const path = `Artifacts/${artifactFileName(artifact.language, null, new Date())}`;
      await createTextFile(chatUploadScope(scopeKey), path, artifact.code);
      return path;
    },
    onSuccess: (path) => path && toast.success(t('artifact.saved', { path })),
  });

  if (!artifact || !open) return null;

  const tabs = [
    { id: 'preview', label: t('artifact.preview') },
    { id: 'code', label: t('artifact.code') },
  ];
  const actions = (
    <ActionMenu
      label={tCommon('more')}
      items={[
        {
          id: 'copy',
          label: copied ? tCommon('copied') : tCommon('copy'),
          icon: copied ? <Check /> : <Copy />,
          onSelect: async () => {
            await copyText(artifact.code);
            setCopied(true);
            toast.success(tCommon('copied'));
            setTimeout(() => setCopied(false), 1500);
          },
        },
        {
          id: 'save',
          label: t('artifact.save'),
          icon: <Save />,
          disabled: save.isPending,
          onSelect: () => save.mutate(),
        },
      ]}
    />
  );
  const body = (
    <div className="min-h-0 flex-1">
      {tab === 'preview' ? (
        <ArtifactPreviewFrame artifact={artifact} />
      ) : (
        <ArtifactCodeView artifact={artifact} />
      )}
    </div>
  );
  const title = `${t('artifact.title')} · ${artifact.language.toUpperCase()}`;

  if (overlay) {
    return (
      <Overlay
        label={title}
        tabs={tabs}
        activeTab={tab}
        onTab={(id) => setTab(id as 'code' | 'preview')}
        actions={actions}
        onClose={onClose}
        bodyClassName="is-flush"
      >
        {body}
      </Overlay>
    );
  }

  return (
    <div className="flex w-[min(42vw,640px)] shrink-0 flex-col border-s">
      <OverlayHead
        label={title}
        tabs={tabs}
        activeTab={tab}
        onTab={(id) => setTab(id as 'code' | 'preview')}
        actions={actions}
        controls={{ onClose, labels: { close: t('artifact.toggle') } }}
      />
      {body}
    </div>
  );
}
