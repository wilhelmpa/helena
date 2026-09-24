'use client';

// Adapted from AI Elements `message` (Apache-2.0, see ./LICENSE): the Markdown of an
// answer, rendered by Streamdown, and the row of actions under a message. The layout of
// a message itself is shadcn's Message and Bubble (components/ui).

import { createContext, memo, useContext, type ComponentProps } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// What every MessageResponse below it renders with unless it says otherwise: the
// plugins, custom renderers, translations and controls an app configures once (Helena's
// are in components/agent-message/AgentMarkdown), so reasoning and tool output read the
// same as the answer around them.
const MessageResponseDefaults = createContext<Omit<MessageResponseProps, 'children'>>({});
export const MessageResponseProvider = MessageResponseDefaults.Provider;

// Streamdown re-parses only the block that is still growing; the memo keeps a finished
// message from re-rendering while the next one streams.
export const MessageResponse = memo(
  function MessageResponse({ className, ...props }: MessageResponseProps) {
    const defaults = useContext(MessageResponseDefaults);
    return (
      <Streamdown
        {...defaults}
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          defaults.className,
          className,
        )}
        {...props}
      />
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.isAnimating === next.isAnimating &&
    prev.parseIncompleteMarkdown === next.parseIncompleteMarkdown &&
    prev.plugins === next.plugins &&
    prev.components === next.components &&
    prev.animated === next.animated &&
    prev.translations === next.translations,
);

export type MessageActionsProps = ComponentProps<'div'>;

export function MessageActions({ className, ...props }: MessageActionsProps) {
  return <div className={cn('flex items-center gap-0.5', className)} {...props} />;
}

export type MessageActionProps = ComponentProps<typeof Button> & {
  // Names the action for the tooltip and for screen readers.
  label: string;
};

export function MessageAction({
  label,
  children,
  variant = 'ghost',
  size = 'icon-xs',
  className,
  ...props
}: MessageActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-label={label}
          className={cn('text-muted-foreground hover:text-foreground', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
