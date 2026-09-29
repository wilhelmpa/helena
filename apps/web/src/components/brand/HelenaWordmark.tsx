'use client';

import { wordmarkGeometry, type WordmarkSize } from '@helena/brand';
import { useDisplayName } from '@/context/displayName';
import { cn } from '@/lib/utils';

// The AVA wordmark (packages/brand): the letters of Inter as outlines, spaced 0.32em,
// in the current text colour.
//   compact  the app's chrome (sidebar, share header): Inter Regular, 10px cap height,
//            about as tall as the sidebar's 13px row text
//   full     sign-in panel and other large places: Inter Light, 28px cap height unless
//            the caller sizes it
// `label` names it for assistive technology where it is the only text; next to a
// visible name it stays decorative.
export default function HelenaWordmark({
  size = 'compact',
  className,
  label,
}: {
  size?: WordmarkSize;
  className?: string;
  label?: string;
}) {
  const appName = useDisplayName();
  if (appName !== 'Ava') return <span className={className}>{appName}</span>;
  const { d, viewBox, width, height } = wordmarkGeometry(size);
  const cap = size === 'compact' ? 10 : 28;
  return (
    <svg
      viewBox={viewBox}
      width={Math.round((cap * width) / height)}
      height={cap}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('shrink-0', className)}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
