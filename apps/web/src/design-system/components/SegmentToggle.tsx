import type { ReactNode } from 'react';

// An on/off switch in a page's toolbar in the look of its segment controls (Auftrag 117:
// no loose pills in a toolbar): the track on surface-2, lifted onto surface-1 while on.
// The org chart's "Aufgaben" ring is one.
export function SegmentToggle({
  pressed,
  onPressedChange,
  children,
  icon,
  title,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <div className="ds-segmented">
      <button
        type="button"
        aria-pressed={pressed}
        title={title}
        onClick={() => onPressedChange(!pressed)}
      >
        {icon}
        <span>{children}</span>
      </button>
    </div>
  );
}
