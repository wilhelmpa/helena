import type { ReactNode } from 'react';

// A segment control (docs/design-system.md §9): the track on surface-2, the chosen
// segment lifted onto surface-1. For a page's layout switch (Board · Liste · Tabelle ·
// Kalender · Zeitstrahl), the org chart's Baum/Kreis and the panel's tabs. Never a second
// navigation: its options are views of the same page.
export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`ds-segmented ${className ?? ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
