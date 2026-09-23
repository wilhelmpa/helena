'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import type { ChatStatus } from 'ai';
import { useTranslations } from 'next-intl';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useVaultUpload } from '../../hooks/useVaultUpload';
import { useChatPrompts } from '../../hooks/useChatPrompts';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useConcurrentChatCheck } from '../../hooks/useConcurrentChatCheck';
import {
  parseSlashCommand,
  slashItems,
  type ChatCommandAction,
  type ChatCommandRefusal,
} from '../../utils/chatCommands';
import { fillPrompt, promptVariables } from '../../utils/promptVariables';
import { CHAT_PROMPT_LIMIT } from '../../utils/chatMessages';
import type { PlanSendOptions } from '../../services/planChatTransport';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
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
  status: ChatStatus;
  onSend: (text: string, options: PlanSendOptions) => void;
  onStop: () => void;
  onNewChat: () => void;
  onRetryLast: () => void;
}

// The claude.ai-style composer: an auto-sizing textarea, drag & drop and pasted images
// landing in the vault, the `/` menu for Hermes' commands and the prompt library, the
// model picker, and a send button that becomes a stop button while an answer streams.
export default function ChatComposer({
  scopeKey,
  agent,
  threadId,
  projectKey,
  status,
  onSend,
  onStop,
  onNewChat,
  onRetryLast,
}: ChatComposerProps) {
  const t = useTranslations('chatWorkspace');
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [fillingPrompt, setFillingPrompt] = useState<ChatPrompt | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useVaultUpload(scopeKey);
  const prompts = useChatPrompts(projectKey);
  const chatSummary = useChatSummary(threadId);
  const { rename } = useChatListMutations();
  // The real, server-configured limit (ai_agent.max_concurrent_chats, an agent setting
  // the owner sets in Helena) — not a per-browser guess, so this pre-flight check
  // reads the same number the server enforces and cannot go stale against it.
  const limit = agent.maxConcurrentChats;
  const checkConcurrency = useConcurrentChatCheck(agent.id, threadId);

  const busy = status === 'streaming' || status === 'submitted';
  const slash = useMemo(() => (!busy ? parseSlashCommand(value) : null), [value, busy]);
  const items = useMemo(
    () => (slash ? slashItems(slash.name, prompts.data ?? []) : []),
    [slash, prompts.data],
  );

  useEffect(() => setHighlight(0), [slash?.name]);

  function resize() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(240, node.scrollHeight)}px`;
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    const paths = await upload.mutateAsync(files);
    setAttachments((current) => [
      ...current,
      ...paths.map((path, index) => ({ path, name: files[index].name })),
    ]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
    if (images.length > 0) void uploadFiles(images);
  }

  function insertPrompt(prompt: ChatPrompt) {
    setValue('');
    if (promptVariables(prompt.content).length > 0) {
      setFillingPrompt(prompt);
      return;
    }
    setValue(prompt.content);
    requestAnimationFrame(() => {
      resize();
      textareaRef.current?.focus();
    });
  }

  function refusalMessage(refusal: ChatCommandRefusal): string {
    switch (refusal) {
      case 'schedules':
        return t('composer.refusal.schedules');
      case 'approvals':
        return t('composer.refusal.approvals');
      case 'config':
        return t('composer.refusal.config');
      case 'outside':
        return t('composer.refusal.outside');
    }
  }

  function runAction(action: ChatCommandAction) {
    setValue('');
    switch (action) {
      case 'new':
        onNewChat();
        return;
      case 'stop':
        onStop();
        return;
      case 'title':
        if (threadId) setRenaming(true);
        return;
      case 'retry':
        onRetryLast();
        return;
      default:
        toast.info(t('composer.commandNotAvailable'));
    }
  }

  function runItem(item: ReturnType<typeof slashItems>[number]) {
    if (item.kind === 'prompt') {
      insertPrompt(item.prompt);
      return;
    }
    if (item.command.refusal) {
      setValue('');
      toast.info(refusalMessage(item.command.refusal));
      return;
    }
    if (item.command.action) runAction(item.command.action);
  }

  async function submit() {
    const text = value.trim();
    if (!text || busy) return;
    if (!(await checkConcurrency(limit))) {
      toast.error(t('composer.concurrencyLimit', { agent: agent.name, limit }));
      return;
    }
    onSend(text, {
      agentId: agent.id,
      files: attachments.map((item) => item.path),
      model,
      thinkingLevel,
    });
    setValue('');
    setAttachments([]);
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (slash && items.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((index) => (index + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((index) => (index - 1 + items.length) % items.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        runItem(items[highlight]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setValue('');
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !slash) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className="border-t bg-background p-3"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="relative mx-auto w-full max-w-3xl">
        {slash && items.length > 0 && (
          <ChatSlashMenu
            items={items}
            highlight={highlight}
            onHighlight={setHighlight}
            onSelect={runItem}
          />
        )}
        <div
          className={`rounded-2xl border bg-card shadow-sm transition-colors ${dragOver ? 'border-primary ring-2 ring-primary/30' : ''}`}
        >
          <ChatComposerAttachments
            attachments={attachments}
            uploading={upload.isPending}
            onRemove={(path) => setAttachments((current) => current.filter((a) => a.path !== path))}
          />
          <Textarea
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
            maxLength={CHAT_PROMPT_LIMIT}
            rows={1}
            className="max-h-60 resize-none border-0 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
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
              onChange={(nextModel, nextLevel) => {
                setModel(nextModel);
                setThinkingLevel(nextLevel);
              }}
            />
            <div className="flex-1" />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={onStop}
                aria-label={t('composer.stop')}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                disabled={!value.trim()}
                onClick={() => void submit()}
                aria-label={t('composer.send')}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <Paperclip className="size-3" />
          {t('composer.hint')}
        </p>
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
            setValue(fillPrompt(fillingPrompt.content, values));
            setFillingPrompt(null);
            requestAnimationFrame(() => {
              resize();
              textareaRef.current?.focus();
            });
          }}
        />
      )}
    </div>
  );
}
