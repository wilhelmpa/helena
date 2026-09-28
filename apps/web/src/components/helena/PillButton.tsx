import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export default function PillButton({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-full px-4 text-xs font-medium transition-colors',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:brightness-110'
          : 'bg-[var(--dashboard-raised)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-ink)]',
        className,
      )}
      {...props}
    />
  );
}
