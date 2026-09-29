import type { ReactNode } from 'react';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import { cn } from '@/lib/utils';

// The brand at full size on the ink panel, the same in both themes: the particle Orb
// over a faint violet glow, the wordmark below it, and whatever the caller adds (the
// sign-in panel's subtitle). Used by the sign-in panel and the About dialog.
export default function BrandHero({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'helena-on-ink relative flex flex-col items-center justify-center gap-6 overflow-hidden bg-helena-ink text-helena-ink-foreground',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,color-mix(in_oklab,var(--ava-glow)_16%,transparent),transparent_60%)] [--ava-glow:#b356dc]"
      />
      <HelenaMark detail="large" onInk className="relative size-24" />
      <HelenaWordmark size="full" label={APP_NAME} className="relative max-w-full" />
      {children}
    </div>
  );
}
