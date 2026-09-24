'use client';

// Adapted from AI Elements `suggestion` (Apache-2.0, see ./LICENSE): answers to pick
// with one press, as a row of pills. Helena offers the choices of an agent's clarifying
// question this way, over the input; typing an answer instead works as always.

import { useCallback, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type SuggestionsProps = ComponentProps<'div'>;

export function Suggestions({ className, ...props }: SuggestionsProps) {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)} {...props} />;
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export function Suggestion({
  suggestion,
  onClick,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: SuggestionProps) {
  const handleClick = useCallback(() => onClick?.(suggestion), [onClick, suggestion]);
  return (
    <Button
      type="button"
      dir="auto"
      variant={variant}
      size={size}
      className={cn('h-7 rounded-full px-3 font-normal', className)}
      onClick={handleClick}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  );
}
