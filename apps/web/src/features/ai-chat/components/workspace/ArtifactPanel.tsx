'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Code2, Copy, Eye, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
// sibling column wide enough, a Sheet overlay below it, so opening one never pushes
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

  const body = (
    <>
      <WorkspaceHeader className="justify-between gap-2 px-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="truncate text-sm font-medium">{t('artifact.title')}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground uppercase">
            {artifact.language}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'code' | 'preview')}>
            <TabsList>
              <TabsTrigger value="preview" aria-label={t('artifact.preview')}>
                <Eye className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="code" aria-label={t('artifact.code')}>
                <Code2 className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              await copyText(artifact.code);
              setCopied(true);
              toast.success(tCommon('copied'));
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label={tCommon('copy')}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            aria-label={t('artifact.save')}
          >
            <Save className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('artifact.toggle')}>
            <X className="size-4" />
          </Button>
        </div>
      </WorkspaceHeader>
      <div className="min-h-0 flex-1">
        {tab === 'preview' ? (
          <ArtifactPreviewFrame artifact={artifact} />
        ) : (
          <ArtifactCodeView artifact={artifact} />
        )}
      </div>
    </>
  );

  if (overlay) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('artifact.title')}</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return <div className="flex w-[min(42vw,640px)] shrink-0 flex-col border-s">{body}</div>;
}
