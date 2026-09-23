// The Helena wordmark: the product name set in the app's own typeface (Inter, the
// sidebar's font), semibold with a slightly closed spacing, so it always matches the
// running UI. The viewBox is cropped to the ink (cap height to baseline), so
// `className` sizes it by its height: h-3 sets the caps at about 11px, the right weight
// next to 13px sidebar text. `label` names it for assistive technology where it is the
// only text; next to a visible name it stays decorative.
export default function HelenaWordmark({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 3.4 60 12.8"
      fill="none"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <text
        x="0"
        y="16"
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
