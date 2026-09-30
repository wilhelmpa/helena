'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { nodeText } from '@/lib/accessibleName';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
        // The design system's quiet button (design-system Button variant="quiet"): the text
        // colour on the page's ground, an inset line, the surface-2 fill on hover - in light and
        // dark alike, no fill of its own.
        outline:
          'bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // The sidebar's 32px row is the default control height
        // (docs/volition-design-helena-ui.md "filigran, kompakt"); on a touch screen
        // globals.css raises every size to a 40px target.
        default: 'h-8 px-3 has-[>svg]:px-2.5',
        sm: 'h-7 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2',
        lg: 'h-9 rounded-md px-4 has-[>svg]:px-3',
        icon: 'size-8',
        'icon-sm': 'size-7 rounded-md',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  // An icon-only button with a title is named by it, so assistive tech and automation
  // that read aria-label see the same words as the hover hint.
  const named =
    props['aria-label'] != null || props['aria-labelledby'] != null || asChild || !props.title;
  const ariaLabel = named || nodeText(props.children) !== '' ? undefined : props.title;

  return (
    <Comp
      data-slot="button"
      data-size={size ?? 'default'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...props}
    />
  );
}

export { Button, buttonVariants };
