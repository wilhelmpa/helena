import type { ReactNode } from 'react';

// A block of monospaced text: the source of a file, a command, a log excerpt. Long lines
// wrap, a long text scrolls inside the block. Not for a diff (TextDiff) and not for
// formatted text (Markdown).
export function CodeBlock({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <pre dir="auto" className="ds-code" aria-label={label}>
      {children}
    </pre>
  );
}
