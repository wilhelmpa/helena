'use client';

import { useMemo } from 'react';
import { diffLines } from 'diff';

// Two versions of a text, line by line (jsdiff): removed lines struck through on a red
// ground, added ones on a green ground, unchanged ones muted. The one diff view of the
// app — skill versions and catalog versions use it alike.
export function TextDiff({ before, after }: { before: string; after: string }) {
  const changes = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre dir="auto" className="ds-diff">
      {changes.map((change, index) => (
        <span
          key={index}
          className="ds-diff-line"
          data-change={change.added ? 'added' : change.removed ? 'removed' : undefined}
        >
          {change.value.replace(/\n$/, '')}
        </span>
      ))}
    </pre>
  );
}
