'use client';

// Adapted from AI Elements `prompt-input` (Apache-2.0, see ./LICENSE): the composer as a
// form around shadcn's InputGroup — a header over the field, the auto-growing textarea,
// a footer with tools on one side and send on the other. Enter submits the form, Shift+
// Enter breaks the line, an IME composition is never cut short.
//
// Trimmed for Helena: AI Elements keeps attachments as blob URLs and hands them over on
// submit; Helena puts a dropped or pasted file into the vault at once (the composer shows
// it uploading), so files go straight to `onFiles` instead. The provider, tabs, command
// and select sub-components are left out; Helena's composer uses its own menus.

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type DragEvent,
  type FormEvent,
  type HTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PromptInputContextValue {
  onFiles?: (files: File[]) => void;
}

const PromptInputContext = createContext<PromptInputContextValue>({});

export interface PromptInputMessage {
  text: string;
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void;
  // Files dropped on the composer or pasted into it.
  onFiles?: (files: File[]) => void;
  // Classes of the InputGroup, the visible box.
  groupClassName?: string;
};

export function PromptInput({
  className,
  groupClassName,
  onSubmit,
  onFiles,
  children,
  ...props
}: PromptInputProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const field = event.currentTarget.elements.namedItem('message');
      const text = field instanceof HTMLTextAreaElement ? field.value : '';
      onSubmit({ text }, event);
    },
    [onSubmit],
  );

  const dragProps = onFiles
    ? {
        onDragOver: (event: DragEvent<HTMLFormElement>) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (event: DragEvent<HTMLFormElement>) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragOver(false);
          onFiles(Array.from(event.dataTransfer.files));
        },
      }
    : {};

  return (
    <PromptInputContext.Provider value={{ onFiles }}>
      <form
        className={cn('w-full', className)}
        onSubmit={handleSubmit}
        data-drag-over={dragOver || undefined}
        {...dragProps}
        {...props}
      >
        <InputGroup
          className={cn(
            'overflow-hidden rounded-xl border-border bg-background shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-ring/60 dark:bg-background',
            dragOver && 'border-brand bg-brand-subtle/40',
            groupClassName,
          )}
        >
          {children}
        </InputGroup>
      </form>
    </PromptInputContext.Provider>
  );
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputBody({ className, ...props }: PromptInputBodyProps) {
  return <div className={cn('contents', className)} {...props} />;
}

// `field-sizing: content` grows the field with its text; where the browser does not know
// it yet, the height follows the scroll height instead.
const fieldSizing = () =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('field-sizing', 'content')
    : true;

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export function PromptInputTextarea({
  onKeyDown,
  onPaste,
  className,
  value,
  ...props
}: PromptInputTextareaProps) {
  const { onFiles } = useContext(PromptInputContext);
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || fieldSizing()) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key !== 'Enter' || event.shiftKey) return;
      if (composing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      const form = event.currentTarget.form;
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit?.disabled) return;
      form?.requestSubmit();
    },
    [onKeyDown, composing],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      onPaste?.(event);
      if (event.defaultPrevented || !onFiles) return;
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file != null);
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    },
    [onPaste, onFiles],
  );

  return (
    <InputGroupTextarea
      ref={ref}
      name="message"
      dir="auto"
      value={value}
      rows={1}
      className={cn(
        'field-sizing-content max-h-60 min-h-10 px-3 pt-2.5 pb-1 text-sm md:text-sm',
        className,
      )}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      {...props}
    />
  );
}

export type PromptInputHeaderProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>;

// Over the field: what waits to be sent, the agent's choices, the answer's state,
// attachments. Renders nothing of its own when empty.
export function PromptInputHeader({ className, ...props }: PromptInputHeaderProps) {
  return (
    <InputGroupAddon
      align="block-start"
      className={cn(
        'flex-col items-stretch gap-1.5 px-2 pt-2 pb-0 font-normal empty:hidden',
        className,
      )}
      {...props}
    />
  );
}

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>;

export function PromptInputFooter({ className, ...props }: PromptInputFooterProps) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('cursor-default justify-between gap-1 px-1.5 pt-0 pb-1.5', className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
  return <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />;
}

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  // The tooltip, and the accessible name of an icon-only button.
  tooltip?: string;
};

export function PromptInputButton({
  variant = 'ghost',
  size = 'icon-sm',
  tooltip,
  className,
  ...props
}: PromptInputButtonProps) {
  const button = (
    <InputGroupButton
      type="button"
      variant={variant}
      size={size}
      aria-label={tooltip}
      className={cn('text-muted-foreground hover:text-foreground', className)}
      {...props}
    />
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  label: string;
};

export function PromptInputSubmit({
  label,
  className,
  children,
  ...props
}: PromptInputSubmitProps) {
  return (
    <InputGroupButton
      type="submit"
      variant="default"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn('rounded-lg', className)}
      {...props}
    >
      {children ?? <ArrowUp className="size-4" />}
    </InputGroupButton>
  );
}
