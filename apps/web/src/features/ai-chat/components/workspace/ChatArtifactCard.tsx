'use client';

import { Code2, FileCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Artifact } from '../../utils/artifacts';

// Sits where the fence was in the answer's text: a small card that opens the artifact
// in the side panel instead of the raw code, the way claude.ai's own artifacts read.
export default function ChatArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const Icon = artifact.language === 'svg' ? FileCode : Code2;

  return (
    <button
      type="button"
      onClick={() => onOpen(artifact)}
      className="flex w-full items-center gap-3 rounded-lg border bg-background/60 p-3 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t('artifact.title')}</span>
        <span className="block text-xs text-muted-foreground uppercase">{artifact.language}</span>
      </span>
    </button>
  );
}
