import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The content-width container every main page uses under PageHeader
// (docs/volition-design-helena-ui.md "Bausteine"): `narrow` for a form (720px, e.g.
// New project, an issue's properties panel), `default` for most pages (1080px,
// settings, lists), `full` for a board or a wide table, which only adds the page's
// side padding and lets the content use the rest of the viewport.
const MAX_WIDTH: Record<'narrow' | 'default' | 'full', string> = {
  narrow: 'max-w-[45rem]',
  default: 'max-w-[67.5rem]',
  full: 'max-w-none',
};

export default function PageBody({
  width = 'default',
  className,
  children,
}: {
  width?: 'narrow' | 'default' | 'full';
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('mx-auto w-full', MAX_WIDTH[width], className)}>{children}</div>;
}
