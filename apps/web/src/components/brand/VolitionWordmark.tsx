// The Volition wordmark: the name drawn as monoline paths in currentColor, so it
// does not depend on a font. `label` names it for assistive technology where it is
// the only text; next to a visible name it stays decorative.
export default function VolitionWordmark({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 3 72 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M1 10 5 20 9 10M27 4v16M32 10v10M37.2 6.5V17q0 3 2.8 3M35 10h5.4M44 10v10M63 20V10m0 4.5a4 4.5 0 0 1 8 0V20" />
      <circle cx="17.5" cy="15" r="5" />
      <circle cx="53.5" cy="15" r="5" />
      <circle cx="32" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="44" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
