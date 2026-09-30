import type { ReactNode } from 'react';
import BrandPanel from './BrandPanel';

// The frame of every logged-out screen (sign-in, register, password reset, invite): the
// form on the page's own surface, the brand panel beside it on the sidebar's, one card
// lifted off a quiet background. `footer` sits under the card (the legal links).
export default function AuthFrame({
  brandSubtitle,
  footer,
  children,
}: {
  brandSubtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-4 md:max-w-4xl">
        <div className="grid overflow-hidden rounded-lg border border-sidebar-border bg-background shadow-[var(--overlay-shadow)] md:grid-cols-2">
          <div className="flex min-w-0 flex-col justify-center">{children}</div>
          <BrandPanel subtitle={brandSubtitle} />
        </div>
        {footer}
      </div>
    </div>
  );
}
