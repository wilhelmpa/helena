'use client';

import type { ReactNode } from 'react';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { useDisplayName } from '@/context/displayName';
import { cn } from '@/lib/utils';

// The brand at full size on Hermes' ink, the surface Hermes Agent draws its banner on,
// the same in both themes: the torch with its shadow lines over a faint amber glow, the
// full wordmark at one art unit per pixel, and whatever the caller adds below (the
// sign-in panel's subtitle). Used by the sign-in panel and the About dialog.
export default function BrandHero({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const appName = useDisplayName();
  return (
    <div
      className={cn(
        'helena-on-ink relative flex flex-col items-center justify-center gap-6 overflow-hidden bg-helena-ink text-helena-ink-foreground',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,color-mix(in_oklab,var(--helena-amber-on-ink)_14%,transparent),transparent_60%)]"
      />
      <HelenaMark detail="large" className="relative size-20" />
      <HelenaWordmark size="full" label={appName} className="relative max-w-full" />
      {children}
    </div>
  );
}
