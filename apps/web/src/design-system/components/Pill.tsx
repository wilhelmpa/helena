import Link from 'next/link';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';

// A pill: a filter, a tag, a short status or a choice in a row of pills.
export type PillTone = 'neutral' | 'active' | 'accent' | 'success' | 'warning' | 'danger';

export type PillSize = 'md' | 'sm';

// `sm` is the tag inside a dense row (a category, a delegate, "archived"): 20px instead of 28.
export function Pill({
  tone = 'neutral',
  size = 'md',
  fit = false,
  icon,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  size?: PillSize;
  // Never wider than the room it is given: a long value is cut by a `truncate` child.
  fit?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      data-size={size === 'md' ? undefined : size}
      data-fit={fit ? '' : undefined}
      className={`ds-pill ${className ?? ''}`}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

// A pill that is a button (filter chip, "+ Filter", a picker trigger).
export function PillButton({
  tone = 'neutral',
  size = 'md',
  fit = false,
  icon,
  children,
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: PillTone;
  size?: PillSize;
  fit?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type={type}
      data-tone={tone}
      data-size={size === 'md' ? undefined : size}
      data-fit={fit ? '' : undefined}
      className={`ds-pill ds-pill-button ${className ?? ''}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

// A pill that is a link (a task, a folder): the same pill, one click away.
export function PillLink({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: PillTone; size?: PillSize; icon?: ReactNode }) {
  return (
    <Link
      data-tone={tone}
      data-size={size === 'md' ? undefined : size}
      className={`ds-pill ds-pill-button ${className ?? ''}`}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}
