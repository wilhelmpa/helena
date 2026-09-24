'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import { teamSectionPath } from '@/utils/paths';
import {
  parseSlashCommand,
  slashItems,
  type ChatCommandAction,
  type ChatCommandRefusal,
  type SlashItem,
} from '../utils/chatCommands';
import { useChatCatalog } from './useChatCatalog';
import { useChatSummary } from './useChatSummary';

export interface ComposerCommandTarget {
  scopeKey: string;
  agent: AiAgent;
  threadId: string | null;
  prompts: ChatPrompt[];
  busy: boolean;
  model: string | null;
  onModelChange: (model: string | null, thinkingLevel: string | null) => void;
  openModelPicker: () => void;
  openRename: () => void;
  insertPrompt: (prompt: ChatPrompt) => void;
  onNewChat: () => void;
  onStop: () => void;
  onRetryLast: () => void;
  onUndo: () => boolean;
}

// The `/` menu of the composer: what the text typed so far offers (the member's saved
// prompts and the Hermes commands, best match first), which one is highlighted, and
// running the one picked. Commands Hermes has in its own CLI are carried out by Helena
// where Helena holds what they change; the rest are refused with why (chatCommands.ts).
export function useComposerCommands(value: string, target: ComposerCommandTarget) {
  const t = useTranslations('chatWorkspace');
  const router = useRouter();
  const catalog = useChatCatalog(target.scopeKey, target.agent.id);
  const chatSummary = useChatSummary(target.threadId);
  const [highlight, setHighlight] = useState(0);

  const slash = useMemo(
    () => (!target.busy ? parseSlashCommand(value) : null),
    [value, target.busy],
  );
  const items = useMemo(
    () => (slash ? slashItems(slash.name, target.prompts) : []),
    [slash, target.prompts],
  );
  useEffect(() => setHighlight(0), [slash?.name]);

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

  // `/model [name]`: alone, opens the model menu; with a name, matches it against the
  // runner's catalog (id or name, exact first, then loosely). A reasoning model picks up
  // its own recommended level.
  function applyModel(query: string) {
    const models = catalog.data?.models ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return target.openModelPicker();
    const match =
      models.find((entry) => entry.id.toLowerCase() === q) ??
      models.find((entry) => entry.name.toLowerCase() === q) ??
      models.find(
        (entry) => entry.id.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q),
      );
    if (!match) return void toast.error(t('composer.modelNotFound', { query: query.trim() }));
    target.onModelChange(
      match.id,
      match.reasoning ? (match.thinkingDefault ?? match.thinkingLevels[0] ?? null) : null,
    );
    toast.success(t('composer.modelSet', { model: match.name }));
  }

  // `/reasoning [level]`: only once a specific model is picked — "Agent default" has no
  // levels of its own to pick from, and the server refuses one on it.
  function applyReasoning(query: string) {
    const selected = (catalog.data?.models ?? []).find((entry) => entry.id === target.model);
    if (!selected || !selected.reasoning || selected.thinkingLevels.length === 0) {
      return void toast.error(t('composer.reasoningNeedsModel'));
    }
    const q = query.trim().toLowerCase();
    if (!q) return target.openModelPicker();
    const level =
      selected.thinkingLevels.find((entry) => entry.toLowerCase() === q) ??
      selected.thinkingLevels.find((entry) => entry.toLowerCase().startsWith(q));
    if (!level) {
      return void toast.error(
        t('composer.reasoningNotFound', { query: query.trim(), model: selected.name }),
      );
    }
    target.onModelChange(selected.id, level);
    toast.success(t('composer.reasoningSet', { level }));
  }

  function runAction(action: ChatCommandAction, args: string) {
    switch (action) {
      case 'new':
        return target.onNewChat();
      case 'stop':
        return target.onStop();
      case 'title':
        return target.threadId ? target.openRename() : undefined;
      case 'retry':
        return target.onRetryLast();
      case 'undo': {
        const undone = target.onUndo();
        return void toast[undone ? 'success' : 'info'](
          t(undone ? 'composer.undoDone' : 'composer.undoNone'),
        );
      }
      case 'model':
        return applyModel(args);
      case 'reasoning':
        return applyReasoning(args);
      case 'usage': {
        // The chat's own token count, the only figure its data carries — no cost is
        // tracked in Helena, so none is made up.
        const tokens = chatSummary.data?.contextTokens;
        return void toast.info(
          tokens == null ? t('composer.usageNone') : t('composer.usage', { tokens }),
        );
      }
      case 'skills':
      case 'memory':
        // The agent's settings are a team page wherever the chat runs; the agent and the
        // section ride along in the query, and the agents page opens them.
        return router.push(
          `${teamSectionPath(target.agent.teamId, 'ai-agents')}?agent=${target.agent.id}&section=${action === 'skills' ? 'skills' : 'abilities'}`,
        );
    }
  }

  // Runs the picked item; the caller clears the text first.
  function run(item: SlashItem) {
    if (item.kind === 'prompt') return target.insertPrompt(item.prompt);
    if (item.command.refusal) return void toast.info(refusalMessage(item.command.refusal));
    if (item.command.action) return runAction(item.command.action, slash?.args ?? '');
    toast.info(t('composer.commandNotAvailable'));
  }

  return { open: slash != null && items.length > 0, items, highlight, setHighlight, run };
}
