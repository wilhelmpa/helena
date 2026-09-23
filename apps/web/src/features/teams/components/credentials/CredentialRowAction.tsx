import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CredentialRowAction({
  label,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-8 text-muted-foreground', destructive && 'hover:text-destructive')}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}
