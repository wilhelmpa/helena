import { useId } from 'react';

// The Helena mark: a lowercase h with a warm point of light over its arch — Helena
// means "the bright one", and the pair also reads as a friendly "hi". Drawn in the
// brand's fixed colours (petrol tile, paper glyph, amber light), the same in light and
// dark: a logo keeps its colours, and the petrol tile holds its contrast on both
// themes. The favicon (`app/icon.svg`), the app icons and public/brand/helena-mark.svg
// are this exact drawing. Decorative; the caller sets the size through `className`.
export default function HelenaMark({ className }: { className?: string }) {
  // The gradient needs a document-unique id: the mark renders more than once per page.
  const gradientId = `helena-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#15808f" />
          <stop offset="1" stopColor="#0e6f81" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <path
        d="M11 7.5v17M11 17c0-2.85 2.15-4.75 5-4.75s5 1.9 5 4.75v7.5"
        stroke="#fbfaf7"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="7.6" r="2.15" fill="#f4c56a" />
    </svg>
  );
}
