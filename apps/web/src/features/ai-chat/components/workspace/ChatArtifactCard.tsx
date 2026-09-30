'use client';

import { Card } from '@/design-system';
import { createContext, useContext } from 'react';
import { Code2, FileCode, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomRenderer, CustomRendererProps } from 'streamdown';
import { isArtifactLanguage, type Artifact } from '../../utils/artifacts';

// Sits where the fence was in the answer's text: a small card that opens the artifact
// in the side panel instead of the raw code, the way claude.ai's own artifacts read.
// While the fence is still being written the card says so and cannot be opened yet.
export default function ChatArtifactCard({
  artifact,
  pending = false,
  onOpen,
}: {
  artifact: Artifact;
  pending?: boolean;
  onOpen: (artifact: Artifact) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const Icon = pending ? LoaderCircle : artifact.language === 'svg' ? FileCode : Code2;

  return (
    <Card
      as="button"
      type="button"
      layout="row"
      interactive
      pad="tight"
      disabled={pending}
      onClick={() => onOpen(artifact)}
      className="my-3 w-full items-center disabled:pointer-events-none"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
        <Icon className={pending ? 'size-4 animate-spin' : 'size-4'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {pending ? t('artifact.writing') : t('artifact.title')}
        </span>
        <span className="block text-xs text-muted-foreground uppercase">{artifact.language}</span>
      </span>
    </Card>
  );
}

// Opens an artifact in the chat's artifact panel; set by the answer that shows the cards.
export const ArtifactOpenContext = createContext<(artifact: Artifact) => void>(() => {});

// An ```html or ```svg fence of an answer, as its card (a Streamdown custom renderer):
// an agent writing a full page fences it as html without necessarily calling it an
// artifact.
function ArtifactFence({ code, language, isIncomplete }: CustomRendererProps) {
  const onOpen = useContext(ArtifactOpenContext);
  const lang = language.toLowerCase();
  if (!isArtifactLanguage(lang)) return null;
  return (
    <ChatArtifactCard
      artifact={{ language: lang, code: code.trim() }}
      pending={isIncomplete || !code.trim()}
      onOpen={onOpen}
    />
  );
}

export const ARTIFACT_RENDERERS: CustomRenderer[] = [
  { language: ['html', 'svg', 'HTML', 'SVG'], component: ArtifactFence },
];
