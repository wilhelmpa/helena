// The Helena monogram: an H drawn with the brand tokens, so it follows the theme. The
// favicon in `app/icon.svg` repeats it in fixed colours. Decorative; the caller sets the
// size through `className`.
export default function HelenaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M10.5 9v14M21.5 9v14M10.5 16h11"
        className="stroke-brand-foreground"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
