// The Helena wordmark: the product name set in the app's own typeface (Inter), so it
// always matches the running UI instead of depending on hand-drawn letterforms. `label`
// names it for assistive technology where it is the only text; next to a visible name it
// stays decorative.
export default function HelenaWordmark({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 82 20"
      fill="none"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <text
        x="0"
        y="15.5"
        fontFamily="var(--font-sans, 'InterVariable', sans-serif)"
        fontSize="17"
        fontWeight="600"
        letterSpacing="-0.02em"
        fill="currentColor"
      >
        Helena
      </text>
    </svg>
  );
}
