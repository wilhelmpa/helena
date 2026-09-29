'use client';

// Adapted from AI Elements `reasoning` (Apache-2.0, see ./LICENSE): what the model
// thought before a stretch of its answer. Open while it is being written, so the reader
// sees the agent working, and closed again a moment after it is done — the answer is
// what the reader came for. A reader who opens or closes it keeps it that way.

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { Brain, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MessageResponse } from './message';

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  // Seconds the thinking took, once it is done; undefined when it was never watched.
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) throw new Error('Reasoning components must be used within Reasoning');
  return context;
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  children,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpen] = useControllableState<boolean>({
    prop: open,
    defaultProp: defaultOpen ?? isStreaming,
    onChange: onOpenChange,
  });
  const [duration, setDuration] = useControllableState<number | undefined>({
    prop: durationProp,
    defaultProp: undefined,
  });
  const everStreamed = useRef(isStreaming);
  const startedAt = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [autoClosed, setAutoClosed] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      everStreamed.current = true;
      startedAt.current ??= Date.now();
    } else if (startedAt.current !== null) {
      setDuration(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
      startedAt.current = null;
    }
  }, [isStreaming, setDuration]);

  useEffect(() => {
    if (isStreaming && !isOpen && !touched) setIsOpen(true);
  }, [isStreaming, isOpen, touched, setIsOpen]);

  useEffect(() => {
    if (!everStreamed.current || isStreaming || !isOpen || autoClosed || touched) return;
    const timer = setTimeout(() => {
      setIsOpen(false);
      setAutoClosed(true);
    }, AUTO_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [isStreaming, isOpen, autoClosed, touched, setIsOpen]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setTouched(true);
      setIsOpen(next);
    },
    [setIsOpen],
  );

  const context = useMemo(
    () => ({ duration, isOpen: isOpen ?? false, isStreaming, setIsOpen }),
    [duration, isOpen, isStreaming, setIsOpen],
  );

  return (
    <ReasoningContext.Provider value={context}>
      <Collapsible
        className={cn('not-prose', className)}
        open={isOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  // The line the trigger shows: "Thinking …" while it streams, else how long it took.
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultThinkingMessage = (isStreaming: boolean, duration?: number) =>
  isStreaming
    ? 'Thinking…'
    : duration === undefined
      ? 'Thought for a few seconds'
      : `Thought for ${duration} seconds`;

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, duration } = useReasoning();
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
          <Brain className="size-3.5 shrink-0" />
          <span className={cn('truncate', isStreaming && 'shimmer')}>
            {getThinkingMessage(isStreaming, duration)}
          </span>
        </>
      )}
    </CollapsibleTrigger>
  );
});

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  const { isStreaming } = useReasoning();
  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    >
      <div className="ms-1.5 border-s border-sidebar-border ps-3 text-sm text-muted-foreground">
        <MessageResponse dir="auto" isAnimating={isStreaming} className="space-y-2">
          {children}
        </MessageResponse>
      </div>
    </CollapsibleContent>
  );
});
