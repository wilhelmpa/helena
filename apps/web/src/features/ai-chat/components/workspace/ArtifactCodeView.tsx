'use client';

import { useMemo } from 'react';
import { highlightAs } from '@/lib/highlight';
import type { Artifact } from '../../utils/artifacts';

// The artifact's code, syntax highlighted with the same highlighter the rest of the
// chat uses for tool output, in a scrollable pane of its own.
export default function ArtifactCodeView({ artifact }: { artifact: Artifact }) {
  const highlighted = useMemo(
    () => highlightAs(artifact.language, artifact.code),
    [artifact.language, artifact.code],
  );

  return (
    <div className="md-content h-full overflow-auto p-4">
      <pre className="text-xs leading-relaxed wrap-break-word whitespace-pre-wrap" dir="ltr">
        <code>{highlighted ?? artifact.code}</code>
      </pre>
    </div>
  );
}
