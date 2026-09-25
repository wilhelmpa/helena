'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { SpeechInput } from '@/components/ai-elements/speech-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { AgentContextSize } from '@/components/common/agent-chat/AgentContextSize';
import ConversationBar from '@/features/voice/components/ConversationBar';
import ConversationButton from '@/features/voice/components/ConversationButton';
import { useDictation } from '@/features/voice/hooks/useDictation';
import type { Conversation } from '@/features/voice/hooks/useConversation';
import { useVaultUpload } from '../../hooks/useVaultUpload';
import { useChatPrompts } from '../../hooks/useChatPrompts';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useConcurrentChatCheck } from '../../hooks/useConcurrentChatCheck';
import { useComposerCommands } from '../../hooks/useComposerCommands';
import { fillPrompt, promptVariables } from '../../utils/promptVariables';
import { CHAT_PROMPT_LIMIT, type PlanChatMetadata } from '../../utils/chatMessages';
import { composerKeyAction } from '../../utils/composerKeys';
import type { PlanSendOptions } from '../../services/planChatTransport';
import type { ChatAgentState } from '../../utils/agentPresence';
import type { ComposerActivity, PendingChoices } from '../../utils/composerActivity';
import ChatAutoSpeakToggle from './ChatAutoSpeakToggle';
import ChatComposerQueue, { type QueuedMessage } from './ChatComposerQueue';
import { ChatPendingAttachment } from './ChatAttachmentChip';
import ChatSlashMenu from './ChatSlashMenu';
import ChatAttachPicker from './ChatAttachPicker';
import ChatModelPicker from './ChatModelPicker';
import ChatRenameDialog from './ChatRenameDialog';
import ChatPromptVariablesDialog from './ChatPromptVariablesDialog';
import ChatComposerStatus from './ChatComposerStatus';
import ChatAgentMenu from './ChatAgentMenu';

interface PendingAttachment {
  path: string;
  name: string;
}

export interface ChatComposerProps {
  scopeKey: string;
  agent: AiAgent;
  // Every agent a chat can be with, and how each is doing, for the picker at the
  // composer's bottom left — picking another one starts a new chat with it.
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  // What the answer is doing, or how it ended (see composerActivity), and the tool it
  // is running right now, if any.
  activity: ComposerActivity;
  tool: string | null;
  // Messages written while an answer was still coming, waiting to go out in order.
  queue: QueuedMessage[];
  queuePaused: boolean;
  onQueue: (text: string, options: PlanSendOptions, metadata: PlanChatMetadata) => void;
  onRemoveQueued: (id: string) => void;
  // The answers the agent offered for its last question (Hermes' clarify), if any.
  choices: PendingChoices | null;
  // The conversation's context size after its last answer (see AgentContextSize);
  // undefined while none has completed.
  contextTokens: number | null | undefined;
  // Answers are read aloud when complete.
  autoSpeak: boolean;
  onAutoSpeakChange: (on: boolean) => void;
  // The hands-free conversation mode (features/voice).
  conversation: Conversation;
  threadId: string | null;
  projectKey: string | null;
  // Where a new chat's text is kept while its agent is still being picked.
  draft?: { current: string };
  busy: boolean;
  model: string | null;
  thinkingLevel: string | null;
  onModelChange: (model: string | null, thinkingLevel: string | null) => void;
  onSend: (text: string, options: PlanSendOptions, metadata: PlanChatMetadata) => void;
  onStop: () => void;
  onNewChat: () => void;
  onPickAgent: (agentId: number) => void;
  onRetryLast: () => void;
  onReconnect: () => void;
  onContinue: () => void;
  onResend: () => void;
  // Drops the last exchange from view and reports whether there was one (`/undo`).
  onUndo: () => boolean;
  // Opens the last own message for editing (↑ in the empty field); absent when there is
  // none.
  onEditLast?: () => void;
}

// The claude.ai-style composer on AI Elements' PromptInput — and the one place the
// conversation's state is shown and steered (owner, 2026-09-24): over the field, what
// waits to be sent (Queue), the choices the agent offered (Suggestions), what the answer
// is doing or how it ended with continue / reconnect / regenerate (a Marker), and the
// files attached; under it the agent (with its presence), the model, attaching,
// dictation and voice mode on the left, the context size, stop and send on the right.
// Files dropped or pasted in land in the vault; `/` opens Hermes' commands and the prompt
// library. Enter sends, Shift+Enter or ⌘/Ctrl+Enter breaks the line, Escape stops the
// answer, ↑ in the empty field edits the last own message.
export default function ChatComposer({
  scopeKey,
  agent,
  agents,
  states,
  activity,
  tool,
  queue,
  queuePaused,
  onQueue,
  onRemoveQueued,
  choices,
  contextTokens,
  autoSpeak,
  onAutoSpeakChange,
  conversation,
  threadId,
  projectKey,
  draft,
  busy,
  model,
  thinkingLevel,
  onModelChange,
  onSend,
  onStop,
  onNewChat,
  onPickAgent,
  onRetryLast,
  onReconnect,
  onContinue,
  onResend,
  onUndo,
  onEditLast,
}: ChatComposerProps) {
  const t = useTranslations('chatWorkspace');
  const [value, setStoredValue] = useState(() => draft?.current ?? '');
  const setValue = (next: string) => {
    setStoredValue(next);
    if (draft) draft.current = next;
  };
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
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
  const dictation = useDictation();
  const talking = conversation.phase !== 'off';

  function focusAfter(update: () => void) {
    update();
    requestAnimationFrame(() => textareaRef.current?.focus());
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

  async function submit() {
    const text = value.trim();
    if (!text || upload.isPending) return;
    const options: PlanSendOptions = {
      agentId: agent.id,
      files: attachments.map((item) => item.path),
      model,
      thinkingLevel,
    };
    const metadata: PlanChatMetadata = {
      attachments: attachments.map((item) => ({
        kind: 'file' as const,
        path: item.path,
        name: item.name,
        contentType: '',
        sizeBytes: 0,
      })),
    };
    // While an answer is still coming (or others wait before it), the message waits its
    // turn instead of being refused or lost.
    if (busy || queue.length > 0) {
      onQueue(text, options, metadata);
    } else {
      if (!(await checkConcurrency(agent.maxConcurrentChats))) {
        toast.error(
          t('composer.concurrencyLimit', { agent: agent.name, limit: agent.maxConcurrentChats }),
        );
        return;
      }
      onSend(text, options, metadata);
    }
    setValue('');
    setAttachments([]);
  }

  // ⌘/Ctrl+Enter breaks the line at the caret like Shift+Enter; setRangeText keeps the
  // browser's own undo working.
  function insertNewline(node: HTMLTextAreaElement) {
    node.setRangeText('\n', node.selectionStart, node.selectionEnd, 'end');
    setValue(node.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerKeyAction(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      },
      { menuOpen: commands.open, busy, empty: value === '', canEditLast: onEditLast != null },
    );
    if (action === 'default') return;
    event.preventDefault();
    const count = commands.items.length;
    switch (action) {
      case 'menu-next':
        return commands.setHighlight((index) => (index + 1) % count);
      case 'menu-previous':
        return commands.setHighlight((index) => (index - 1 + count) % count);
      case 'menu-pick': {
        const item = commands.items[commands.highlight];
        setValue('');
        return commands.run(item);
      }
      case 'menu-close':
        return setValue('');
      case 'stop':
        return onStop();
      case 'newline':
        return insertNewline(event.currentTarget);
      case 'edit-last':
        return onEditLast?.();
    }
  }

  const showChoices = choices != null && !busy && queue.length === 0;

  return (
    <div className="shrink-0 bg-background px-3 pt-2 pb-3">
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
        {/* The labels at the composer's bottom (agent, status, model) show by the
            composer's own width, which the tool panel or an open artifact narrows. */}
        <PromptInput
          className="@container/composer"
          onSubmit={() => void submit()}
          onFiles={(files) => void uploadFiles(files)}
        >
          <PromptInputHeader>
            <ConversationBar conversation={conversation} agentName={agent.name} />
            <ChatComposerQueue
              queue={queue}
              agentName={agent.name}
              paused={queuePaused}
              onRemove={onRemoveQueued}
            />
            {showChoices && (
              <div className="space-y-1.5 px-1 pt-0.5">
                {choices.question ? (
                  <p dir="auto" className="text-xs text-muted-foreground">
                    {choices.question}
                  </p>
                ) : null}
                <Suggestions>
                  {choices.choices.map((choice) => (
                    <Suggestion
                      key={choice}
                      suggestion={choice}
                      onClick={(picked) =>
                        onSend(picked, { agentId: agent.id, model, thinkingLevel }, {})
                      }
                    />
                  ))}
                </Suggestions>
              </div>
            )}
            <ChatComposerStatus
              activity={activity}
              tool={tool}
              agentName={agent.name}
              onReconnect={onReconnect}
              onContinue={onContinue}
              onRegenerate={onRetryLast}
              onResend={onResend}
            />
            {(attachments.length > 0 || upload.isPending) && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {attachments.map((attachment) => (
                  <ChatPendingAttachment
                    key={attachment.path}
                    name={attachment.name}
                    removeLabel={t('composer.removeAttachment', { name: attachment.name })}
                    onRemove={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.path !== attachment.path),
                      )
                    }
                  />
                ))}
                {upload.isPending && (
                  <ChatPendingAttachment name={t('composer.uploading')} uploading />
                )}
              </div>
            )}
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                talking ? t('voice.placeholder') : t('composer.placeholder', { agent: agent.name })
              }
              aria-label={t('composer.placeholder', { agent: agent.name })}
              title={t('composer.hint')}
              maxLength={CHAT_PROMPT_LIMIT}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools className="overflow-hidden">
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
              {dictation.ready && !talking && (
                <SpeechInput
                  value={value}
                  onChange={setValue}
                  maxLength={CHAT_PROMPT_LIMIT}
                  engine={dictation.engine}
                  recorder={dictation.recorder}
                  onUnavailable={dictation.onUnavailable}
                  onError={dictation.onError}
                  labels={{
                    start: dictation.local ? t('composer.dictateLocal') : t('composer.dictate'),
                    stop: t('composer.stopDictation'),
                    unavailable: t('composer.dictationUnavailable'),
                  }}
                />
              )}
              <ChatAutoSpeakToggle on={autoSpeak} onChange={onAutoSpeakChange} />
              <ChatAgentMenu agent={agent} agents={agents} states={states} onPick={onPickAgent} />
              <ChatModelPicker
                scopeKey={scopeKey}
                agentId={agent.id}
                model={model}
                thinkingLevel={thinkingLevel}
                onChange={onModelChange}
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
              />
            </PromptInputTools>
            <PromptInputTools className="shrink-0">
              {threadId && contextTokens !== undefined && (
                <span className="px-1">
                  <AgentContextSize tokens={contextTokens} />
                </span>
              )}
              {activity === 'answered' && !busy && (
                <PromptInputButton tooltip={t('messages.regenerate')} onClick={onRetryLast}>
                  <RefreshCw className="size-4" />
                </PromptInputButton>
              )}
              {busy && (
                <PromptInputButton
                  variant="secondary"
                  tooltip={t('composer.stop')}
                  className="rounded-lg text-foreground"
                  onClick={onStop}
                >
                  <Square className="size-3 fill-current" />
                </PromptInputButton>
              )}
              {value.trim() ? (
                <PromptInputSubmit
                  label={busy ? t('composer.queue') : t('composer.send')}
                  disabled={upload.isPending}
                />
              ) : conversation.ready || talking ? (
                // With nothing typed, the send button's place starts a conversation (the
                // claude.ai/ChatGPT pattern); while one runs, it ends it.
                <ConversationButton conversation={conversation} />
              ) : (
                !busy && <PromptInputSubmit label={t('composer.send')} disabled />
              )}
            </PromptInputTools>
          </PromptInputFooter>
        </PromptInput>
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
