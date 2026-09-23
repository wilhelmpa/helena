import type { ReactNode } from 'react';
import HelenaMark from '@/components/brand/HelenaMark';

// The title block of a logged-out form. The mark stands above it on a phone, where the
// brand panel beside the form is hidden.
export default function AuthFormHeader({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <HelenaMark className="mb-3 size-11 md:hidden" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-caption text-balance text-muted-foreground">{description}</p>
    </div>
  );
}
