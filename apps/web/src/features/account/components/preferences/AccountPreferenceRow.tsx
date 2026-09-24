'use client';

import type { ReactNode } from 'react';

// One preference: its name and a short explanation on the left, the control on the
// right in a column of fixed width, so every control of a card lines up. On a narrow
// screen the control drops under the text instead of squeezing it.
export default function AccountPreferenceRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 sm:w-44 sm:justify-end">{children}</div>
    </div>
  );
}
