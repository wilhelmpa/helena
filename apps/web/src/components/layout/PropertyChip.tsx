// A property to show or hide (Anzeige): a choice chip of the design system, lifted onto
// surface-3 when shown — never a filled primary pill, which reads as a button.
export default function PropertyChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="ds-choice-chip">
      {label}
    </button>
  );
}
