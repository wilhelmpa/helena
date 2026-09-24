import { useId } from 'react';

// The Helena mark (2026-09-24, "Funke"): an H of two pillars with a four-point spark
// where the crossbar would be -- the work and the people on either side, the agents'
// spark joining them; Helena means "the bright one". An ink tile with paper pillars
// and an amber spark, the same dark as the app's primary buttons; in the dark theme it
// turns to a paper tile with ink pillars so it keeps its weight on a dark sidebar. The
// favicon (`app/icon.svg`), the app icons and public/brand/helena-mark.svg are the
// light drawing. Decorative; the caller sets the size through `className`.
export const MARK_PILLARS = 'M9.8 8.4v15.2M22.2 8.4v15.2';
export const MARK_SPARK =
  'M16 10.9c.6 2.85 2.25 4.5 5.1 5.1-2.85.6-4.5 2.25-5.1 5.1-.6-2.85-2.25-4.5-5.1-5.1 2.85-.6 4.5-2.25 5.1-5.1z';

export default function HelenaMark({ className }: { className?: string }) {
  // The gradients need document-unique ids: the mark renders more than once per page.
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient
          id={`${id}-ink`}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#2e2a26" />
          <stop offset="1" stopColor="#161411" />
        </linearGradient>
        <linearGradient
          id={`${id}-paper`}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f6f3ec" />
          <stop offset="1" stopColor="#e4ded2" />
        </linearGradient>
      </defs>
      <g className="dark:hidden">
        <rect width="32" height="32" rx="8.5" fill={`url(#${id}-ink)`} />
        <path d={MARK_PILLARS} stroke="#fbfaf7" strokeWidth="3.3" strokeLinecap="round" />
        <path d={MARK_SPARK} fill="#f6c35f" />
      </g>
      <g className="hidden dark:inline">
        <rect width="32" height="32" rx="8.5" fill={`url(#${id}-paper)`} />
        <path d={MARK_PILLARS} stroke="#1d1b18" strokeWidth="3.3" strokeLinecap="round" />
        <path d={MARK_SPARK} fill="#dc9a17" />
      </g>
    </svg>
  );
}
