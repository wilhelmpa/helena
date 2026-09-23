'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import type { ChatStatus } from 'ai';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { teamSectionPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useVaultUpload } from '../../hooks/useVaultUpload';
import { useChatPrompts } from '../../hooks/useChatPrompts';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useChatCatalog } from '../../hooks/useChatCatalog';
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
  // Drops the last exchange (the last question and its answer) from view and reports
  // whether there was one to drop, for the `/undo` command. Nothing is sent, so this is
  // a client-side branch point: it only becomes durable once the member sends the next
  // message, which then continues from before the exchange, same as editing an earlier
  // question does. Reloading before that shows the exchange again.
  onUndo: () => boolean;
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
  onUndo,
}: ChatComposerProps) {
  const t = useTranslations('chatWorkspace');
  const router = useRouter();
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [fillingPrompt, setFillingPrompt] = useState<ChatPrompt | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useVaultUpload(scopeKey);
  const prompts = useChatPrompts(projectKey);
  const chatSummary = useChatSummary(threadId);
  const catalog = useChatCatalog(scopeKey, agent.id);
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

  // `/model [name]`: with no name, opens the same menu the picker button does; with
  // one, matches it against the runner's published catalog (id or name, exact first
  // then a loose match) and sets it directly. A reasoning model picks up its own
  // recommended level, so `/model` alone is enough to use it.
  function applyModelCommand(query: string) {
    const models = catalog.data?.models ?? [];
    const q = query.trim();
    if (!q) {
      setModelPickerOpen(true);
      return;
    }
    const lower = q.toLowerCase();
    const match =
      models.find((entry) => entry.id.toLowerCase() === lower) ??
      models.find((entry) => entry.name.toLowerCase() === lower) ??
      models.find(
        (entry) =>
          entry.id.toLowerCase().includes(lower) || entry.name.toLowerCase().includes(lower),
      );
    if (!match) {
      toast.error(t('composer.modelNotFound', { query: q }));
      return;
    }
    setModel(match.id);
    setThinkingLevel(
      match.reasoning ? (match.thinkingDefault ?? match.thinkingLevels[0] ?? null) : null,
    );
    toast.success(t('composer.modelSet', { model: match.name }));
  }

  // `/reasoning [level]`: only meaningful once a specific model is picked (see
  // applyModelCommand) — the server itself refuses a thinking level on "Agent
  // default" since it does not know which model that resolves to.
  function applyReasoningCommand(query: string) {
    const selected = (catalog.data?.models ?? []).find((entry) => entry.id === model);
    if (!selected || !selected.reasoning || selected.thinkingLevels.length === 0) {
      toast.error(t('composer.reasoningNeedsModel'));
      return;
    }
    const q = query.trim();
    if (!q) {
      setModelPickerOpen(true);
      return;
    }
    const lower = q.toLowerCase();
    const level =
      selected.thinkingLevels.find((entry) => entry.toLowerCase() === lower) ??
      selected.thinkingLevels.find((entry) => entry.toLowerCase().startsWith(lower));
    if (!level) {
      toast.error(t('composer.reasoningNotFound', { query: q, model: selected.name }));
      return;
    }
    setThinkingLevel(level);
    toast.success(t('composer.reasoningSet', { level }));
  }

  // `/usage`: the chat's own token count (see useChatSummary), the only figure this
  // chat's data actually carries — no cost is tracked anywhere in Plan, so none is
  // shown rather than made up.
  function showUsage() {
    const tokens = chatSummary.data?.contextTokens;
    toast.info(tokens == null ? t('composer.usageNone') : t('composer.usage', { tokens }));
  }

  // `/skills` and `/memory`: the agent's settings sheet is a team-level page regardless
  // of where the chat runs, so this always sends the member to the team's AI agents
  // list — never a dead end — with the agent and section named in the query string;
  // TeamAiAgents reads them, opens that agent's sheet on that section and drops the
  // params right away.
  function openAgentSection(section: 'skills' | 'abilities') {
    router.push(
      `${teamSectionPath(agent.teamId, 'ai-agents')}?agent=${agent.id}&section=${section}`,
    );
  }

  function runAction(action: ChatCommandAction) {
    const args = slash?.args ?? '';
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
      case 'undo': {
        const undone = onUndo();
        toast[undone ? 'success' : 'info'](t(undone ? 'composer.undoDone' : 'composer.undoNone'));
        return;
      }
      case 'model':
        applyModelCommand(args);
        return;
      case 'reasoning':
        applyReasoningCommand(args);
        return;
      case 'usage':
        showUsage();
        return;
      case 'skills':
        openAgentSection('skills');
        return;
      case 'memory':
        openAgentSection('abilities');
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
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
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
