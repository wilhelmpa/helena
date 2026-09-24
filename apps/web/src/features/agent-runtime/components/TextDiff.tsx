'use client';

import { useMemo } from 'react';
import { diffLines } from 'diff';
import { cn } from '@/lib/utils';

// Two versions of a text, line by line: removed lines struck in red, added ones in green,
// unchanged ones muted (jsdiff).
export default function TextDiff({ before, after }: { before: string; after: string }) {
  const changes = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre
      dir="auto"
      className="max-h-80 overflow-auto rounded-md bg-card p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
    >
      {changes.map((change, index) => (
        <span
          key={index}
          className={cn(
            'block',
            change.added && 'bg-status-success/15 text-foreground',
            change.removed &&
              'bg-status-danger/15 text-foreground line-through decoration-status-danger/60',
            !change.added && !change.removed && 'text-muted-foreground',
          )}
        >
          {change.value.replace(/\n$/, '')}
        </span>
      ))}
    </pre>
  );
}
