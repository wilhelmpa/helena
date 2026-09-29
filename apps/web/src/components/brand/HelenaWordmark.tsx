'use client';

import { wordmarkArt, type WordmarkSize } from '@helena/brand';
import { useDisplayName } from '@/context/displayName';
import { cn } from '@/lib/utils';

// The Helena wordmark (packages/brand): HELENA in ANSI Shadow, the block capitals of
// Hermes Agent's banner, drawn as paths in the theme's gold/amber/bronze bands
// (--helena-gold/-amber/-bronze in globals.css; `helena-on-ink` on a dark brand
// surface forces Hermes' own colours).
//   compact  the app's chrome (sidebar, share header): 75 × 21px, half a pixel per art
//            unit, so every edge falls on a whole device pixel of a 2× screen
//   full     sign-in panel and other large places; 300px wide unless the caller says
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
  if (appName !== 'Helena') return <span className={className}>{appName}</span>;
  const { width, height, rows } = wordmarkArt(size);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      // The letters fill the upper five of the six rows; the sixth holds only the thin
      // shadow line. Centred as a box next to the square mark they sat 2px high (owner,
      // 2026-09-24: "nicht vertikal bündig mit dem Logo"), so the compact size moves down.
      style={
        size === 'compact'
          ? { width: width / 2, height: height / 2, transform: 'translateY(2px)' }
          : undefined
      }
      className={cn(size === 'full' && 'h-auto w-[300px]', className)}
    >
      {rows.map((row, i) => (
        <path key={i} d={row.d} fill={`var(--helena-${row.band})`} />
      ))}
    </svg>
  );
}
