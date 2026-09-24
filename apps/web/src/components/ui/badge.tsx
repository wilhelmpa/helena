'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-1.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        // The emphasised badge (an owner among members, a live state): the brand's quiet
        // tint, not a filled dark block — the page's one filled element is its primary
        // button (docs/volition/ui-standard.md).
        default: 'border-transparent bg-brand-subtle text-foreground [a&]:hover:bg-brand-subtle/80',
        secondary: 'border-transparent bg-accent text-accent-foreground [a&]:hover:bg-accent/80',
        destructive: 'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
