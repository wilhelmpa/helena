'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useVaultUpload } from '../../hooks/useVaultUpload';
import { useChatPrompts } from '../../hooks/useChatPrompts';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useConcurrentChatCheck } from '../../hooks/useConcurrentChatCheck';
import { useComposerCommands } from '../../hooks/useComposerCommands';
import { fillPrompt, promptVariables } from '../../utils/promptVariables';
import { CHAT_PROMPT_LIMIT, type PlanChatMetadata } from '../../utils/chatMessages';
import type { PlanSendOptions } from '../../services/planChatTransport';
import ChatComposerAttachments, { type PendingAttachment } from './ChatComposerAttachments';
import ChatSlashMenu from './ChatSlashMenu';
import ChatAttachPicker from './ChatAttachPicker';
import ChatModelPicker from './ChatModelPicker';
import ChatRenameDialog from './ChatRenameDialog';
import ChatPromptVariablesDialog from './ChatPromptVariablesDialog';

export interface ChatComposerProps {
  scopeKey: string;
  agent: AiAgent;
  threadId: string | null;
  projectKey: string | null;
  // At the bottom of a conversation (a hairline above it), or centered in a new chat.
  docked: boolean;
  // Where a new chat's text is kept while its agent is still being picked.
  draft?: { current: string };
  busy: boolean;
  model: string | null;
  thinkingLevel: string | null;
  onModelChange: (model: string | null, thinkingLevel: string | null) => void;
  onSend: (text: string, options: PlanSendOptions, metadata: PlanChatMetadata) => void;
  onStop: () => void;
  onNewChat: () => void;
  onRetryLast: () => void;
  // Drops the last exchange from view and reports whether there was one (`/undo`).
  onUndo: () => boolean;
}

// The claude.ai-style composer, kept slim: an auto-sizing textarea, files dropped or
// pasted into it landing in the vault, the `/` menu for Hermes' commands and the prompt
// library, the model (and reasoning) picker, and a send button that turns into stop
// while an answer is written. Enter sends, Shift+Enter breaks the line.
export default function ChatComposer({
  scopeKey,
  agent,
  threadId,
  projectKey,
  docked,
  draft,
  busy,
  model,
  thinkingLevel,
  onModelChange,
  onSend,
  onStop,
  onNewChat,
  onRetryLast,
  onUndo,
}: ChatComposerProps) {
  const t = useTranslations('chatWorkspace');
  const [value, setStoredValue] = useState(() => draft?.current ?? '');
  const setValue = (next: string) => {
    setStoredValue(next);
    if (draft) draft.current = next;
  };
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [fillingPrompt, setFillingPrompt] = useState<ChatPrompt | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useVaultUpload(scopeKey);
  const prompts = useChatPrompts(projectKey);
  const chatSummary = useChatSummary(threadId);
  const { rename } = useChatListMutations();
  // The server-configured limit (the agent's max_concurrent_chats), checked before
  // sending so a member hits it here rather than as a refused send.
  const checkConcurrency = useConcurrentChatCheck(agent.id, threadId);

  function resize() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(240, node.scrollHeight)}px`;
  }

  function focusAfter(update: () => void) {
    update();
    requestAnimationFrame(() => {
      resize();
      textareaRef.current?.focus();
    });
  }

  const commands = useComposerCommands(value, {
    scopeKey,
    agent,
    threadId,
    prompts: prompts.data ?? [],
    busy,
    model,
    onModelChange,
    openModelPicker: () => setModelPickerOpen(true),
    openRename: () => setRenaming(true),
    insertPrompt: (prompt) => {
      if (promptVariables(prompt.content).length > 0) setFillingPrompt(prompt);
      else focusAfter(() => setValue(prompt.content));
    },
    onNewChat,
    onStop,
    onRetryLast,
    onUndo,
  });

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    try {
      const paths = await upload.mutateAsync(files);
      setAttachments((current) => [
        ...current,
        ...paths.map((path, index) => ({ path, name: files[index].name })),
      ]);
    } catch {
      toast.error(t('composer.uploadFailed'));
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  }

  async function submit() {
    const text = value.trim();
    if (!text || busy || upload.isPending) return;
    if (!(await checkConcurrency(agent.maxConcurrentChats))) {
      toast.error(
        t('composer.concurrencyLimit', { agent: agent.name, limit: agent.maxConcurrentChats }),
      );
      return;
    }
    onSend(
      text,
      { agentId: agent.id, files: attachments.map((item) => item.path), model, thinkingLevel },
      {
        attachments: attachments.map((item) => ({
          kind: 'file' as const,
          path: item.path,
          name: item.name,
          contentType: '',
          sizeBytes: 0,
        })),
      },
    );
    setValue('');
    setAttachments([]);
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (commands.open) {
      const count = commands.items.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        commands.setHighlight((index) => (index + step + count) % count);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const item = commands.items[commands.highlight];
        setValue('');
        commands.run(item);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setValue('');
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className={cn('shrink-0 bg-background px-3 pt-2 pb-3', !docked && 'pb-2')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="relative mx-auto w-full max-w-3xl">
        {commands.open && (
          <ChatSlashMenu
            items={commands.items}
            highlight={commands.highlight}
            onHighlight={commands.setHighlight}
            onSelect={(item) => {
              setValue('');
              commands.run(item);
            }}
          />
        )}
        <div
          className={cn(
            'rounded-xl border border-border bg-background transition-colors focus-within:border-ring/60',
            dragOver && 'border-brand bg-brand-subtle/40',
          )}
        >
          <ChatComposerAttachments
            attachments={attachments}
            uploading={upload.isPending}
            onRemove={(path) => setAttachments((current) => current.filter((a) => a.path !== path))}
          />
          <textarea
            ref={textareaRef}
            dir="auto"
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setValue(event.target.value);
              resize();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={t('composer.placeholder', { agent: agent.name })}
            aria-label={t('composer.placeholder', { agent: agent.name })}
            title={t('composer.hint')}
            maxLength={CHAT_PROMPT_LIMIT}
            rows={1}
            className="block max-h-60 min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <ChatAttachPicker
              scopeKey={scopeKey}
              onUpload={() => fileInputRef.current?.click()}
              onPickVaultFile={(path, name) =>
                setAttachments((current) => [...current, { path, name }])
              }
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void uploadFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <ChatModelPicker
              scopeKey={scopeKey}
              agentId={agent.id}
              model={model}
              thinkingLevel={thinkingLevel}
              onChange={onModelChange}
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
            />
            <div className="flex-1" />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="size-8 rounded-lg"
                onClick={onStop}
                aria-label={t('composer.stop')}
                title={t('composer.stop')}
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className="size-8 rounded-lg"
                disabled={!value.trim() || upload.isPending}
                onClick={() => void submit()}
                aria-label={t('composer.send')}
                title={t('composer.send')}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {renaming && threadId && (
        <ChatRenameDialog
          initialTitle={chatSummary.data?.title ?? ''}
          onClose={() => setRenaming(false)}
          onConfirm={(title) => rename.mutateAsync({ threadId, title })}
        />
      )}
      {fillingPrompt && (
        <ChatPromptVariablesDialog
          prompt={fillingPrompt}
          onClose={() => setFillingPrompt(null)}
          onConfirm={(values) => {
            const filled = fillPrompt(fillingPrompt.content, values);
            setFillingPrompt(null);
            focusAfter(() => setValue(filled));
          }}
        />
      )}
    </div>
  );
}
