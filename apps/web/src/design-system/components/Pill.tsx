import type { HTMLAttributes, ReactNode } from 'react';

// A pill: a filter, a tag, a short status or a choice in a row of pills.
export type PillTone = 'neutral' | 'active' | 'accent' | 'success' | 'warning' | 'danger';

export function Pill({
  tone = 'neutral',
  icon,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone; icon?: ReactNode }) {
  return (
    <span data-tone={tone} className={`ds-pill ${className ?? ''}`} {...props}>
      {icon}
      {children}
    </span>
  );
}

// A pill that is a button (filter chip, "+ Filter", a picker trigger).
export function PillButton({
  tone = 'neutral',
  icon,
  children,
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: PillTone; icon?: ReactNode }) {
  return (
    <button
      type={type}
      data-tone={tone}
      className={`ds-pill ds-pill-button ${className ?? ''}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
