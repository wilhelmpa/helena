'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ARTIFACT_SANDBOX, artifactDocument, type Artifact } from '../../utils/artifacts';

// The live preview: a sandboxed frame with the artifact as its srcdoc. `allow-scripts`
// without `allow-same-origin` puts the frame in a different origin from the app even
// though it has no src of its own, so a script in it can neither read Plan's cookies
// and storage nor call Plan's API — and the artifact's own Content-Security-Policy (see
// artifactDocument) keeps it from loading anything over the network at all.
export default function ArtifactPreviewFrame({ artifact }: { artifact: Artifact }) {
  const t = useTranslations('chatWorkspace');
  const srcDoc = useMemo(() => artifactDocument(artifact), [artifact]);

  return (
    <iframe
      title={t('artifact.title')}
      srcDoc={srcDoc}
      sandbox={ARTIFACT_SANDBOX}
      className="size-full border-0 bg-white"
    />
  );
}
