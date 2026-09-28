import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';

// Buttons (docs/design-system.md §4): primary (the one main action of a page), quiet (an
// outlined action in text colour, like "+ Neue Aufgabe"), ghost (no surface until hover).
// All are pills of one height; an icon may lead the label.
export type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'danger';

type BaseProps = {
  variant?: ButtonVariant;
  icon?: ReactNode;
  size?: 'default' | 'small';
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & BaseProps
>(function Button(
  { variant = 'quiet', icon, size = 'default', className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      className={`ds-button ${className ?? ''}`}
      {...props}
    >
      {icon}
      {children != null && <span className="ds-button-label">{children}</span>}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = 'quiet',
  icon,
  size = 'default',
  className,
  children,
}: BaseProps & { href: string; className?: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      data-variant={variant}
      data-size={size}
      className={`ds-button ${className ?? ''}`}
    >
      {icon}
      {children != null && <span className="ds-button-label">{children}</span>}
    </Link>
  );
}

// A square icon-only button; the label is required (tooltip and screen readers).
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
    label: string;
    size?: 'default' | 'small';
    pressed?: boolean;
  }
>(function IconButton(
  { label, size = 'default', pressed, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-size={size}
      className={`ds-icon-button ${className ?? ''}`}
      {...props}
    />
  );
});
