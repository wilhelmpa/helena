import type { ReactNode } from 'react';
import { Inline, Text } from '@/design-system';

// A label with its control at the end of the line, in the panel of a matrix cell.
export function EditorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Inline justify="between" gap={3}>
      <Text tone="muted">{label}</Text>
      {children}
    </Inline>
  );
}
