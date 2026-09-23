// The Volition monogram: a lowercase v in a rounded square, drawn with the brand
// tokens so it follows the theme. The favicon in `app/icon.svg` repeats it in fixed
// colours. Decorative; the caller sets the size through `className`.
export default function VolitionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M9.5 11 15.5 22 23 9.5"
        className="stroke-brand-foreground"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
