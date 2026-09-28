'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { overlayPosition } from '@/components/common/overlay/overlayPosition';
import OverlayPortal from '@/components/common/overlay/OverlayPortal';
import { elementHasName, nodeText } from '@/lib/accessibleName';

// The words of a Tooltip's content, read from its children when the tooltip is built.
// An icon-only trigger takes them as its accessible name: Radix only links the content
// (aria-describedby) while it is open, so a closed tooltip left the button nameless.
const TooltipLabelContext = React.createContext<string | undefined>(undefined);

function contentLabel(children: React.ReactNode): string | undefined {
  let label: string | undefined;
  React.Children.forEach(children, (child) => {
    if (label || !React.isValidElement<{ children?: React.ReactNode }>(child)) return;
    if (child.type === TooltipContent) label = nodeText(child.props.children) || undefined;
  });
  return label;
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props}>
        <TooltipLabelContext.Provider value={contentLabel(children)}>
          {children}
        </TooltipLabelContext.Provider>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
}

// A wrapper span or div (around a disabled button) is not a control: no name for it.
function namesControl(child: React.ReactNode, asChild: boolean | undefined): boolean {
  if (!asChild) return true;
  return React.isValidElement(child) && child.type !== 'span' && child.type !== 'div';
}

function TooltipTrigger({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const label = React.useContext(TooltipLabelContext);
  const named =
    props['aria-label'] != null ||
    props['aria-labelledby'] != null ||
    (props.asChild ? elementHasName(children) : nodeText(children) !== '');
  const fallback = label && !named && namesControl(children, props.asChild) ? label : undefined;
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" aria-label={fallback} {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  );
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <OverlayPortal as={TooltipPrimitive.Portal}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...overlayPosition}
        className={cn(
          'z-50 max-h-(--radix-tooltip-content-available-height) w-fit max-w-[calc(100vw-16px)] animate-in overflow-y-auto rounded-md border bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-md fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </OverlayPortal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
