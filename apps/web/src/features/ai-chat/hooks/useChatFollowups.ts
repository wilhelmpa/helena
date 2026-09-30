'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import {
  getFollowups,
  type Followup,
  type FollowupMode,
  type FollowupTarget,
} from '@/lib/api/endpoints/agentFollowups';
import { useAgentFollowups } from '@/hooks/useAgentFollowups';
import { uuid } from '@/utils/uuid';
import type { PlanUIMessage } from '../utils/chatMessages';
import {
  followupTargetOf,
  hasWaiting,
  orderedModes,
  queuedAnswers,
  visibleFollowups,
} from '../utils/followups';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// How long the chat waits for the server to turn an instruction that came too late for the
// answer into the next turn.
const FOLLOW_DELAYS = [300, 800, 1600, 3200, 5000];

const queryKey = (target: FollowupTarget) => ['agentFollowups', target] as const;

// Steering the answer that is running (Claude Code style): what is typed while the agent
// works goes in as an instruction — taken over at the next step ("inject"), after the
// answer ("after"), or in place of the step that runs ("replace") — instead of waiting in a
// queue of the browser. This holds what the chat needs of it: the modes the runtime
// supports, the send, the instructions of each answer for the transcript, and following the
// next turn the server starts on its own once the answer they waited for is over.
export function useChatFollowups({
  scopeKey,
  agentId,
  messages,
  busy,
  followAnswer,
}: {
  scopeKey: string;
  agentId: number;
  messages: PlanUIMessage[];
  busy: boolean;
  followAnswer: (ref: { agentId: number; messageId: number }) => Promise<void>;
}) {
  const t = useTranslations('chatWorkspace.followups');
  const client = useQueryClient();
  const target = followupTargetOf(scopeKey, agentId, messages);
  const followups = useAgentFollowups(target);
  const modes = useMemo(() => orderedModes(followups.modes), [followups.modes]);

  // The answers an instruction was sent to: they may still start a next turn, and their
  // instructions stay under them in the transcript.
  const [sent, setSent] = useState<FollowupTarget[]>([]);
  const shown = useMemo(
    () => (target && !sent.some((entry) => entry.id === target.id) ? [...sent, target] : sent),
    [sent, target],
  );
  const lists = useQueries({
    queries: shown.map((entry) => ({
      queryKey: queryKey(entry),
      queryFn: () => getFollowups(entry),
    })),
  });
  const notes = useMemo(() => {
    const out = new Map<string, Followup[]>();
    shown.forEach((entry, index) => {
      const visible = visibleFollowups(lists[index]?.data?.items ?? []);
      if (visible.length > 0) out.set(String(entry.id), visible);
    });
    return out;
  }, [shown, lists]);

  const send = useCallback(
    async (mode: FollowupMode, prompt: string): Promise<boolean> => {
      if (!target) return false;
      try {
        await followups.send({ id: uuid(), prompt, mode });
      } catch {
        toast.error(t('failed'));
        return false;
      }
      setSent((current) =>
        current.some((entry) => entry.id === target.id) ? current : [...current, target],
      );
      return true;
    },
    [target, followups, t],
  );

  // The answer ended: an instruction waiting for it becomes the next turn on the server, a
  // moment later. Ask until it does, then follow that answer — and the one after it.
  const wasBusy = useRef(false);
  const latest = useRef({ messages, followAnswer, sent });
  useEffect(() => {
    latest.current = { messages, followAnswer, sent };
  });
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current || latest.current.sent.length === 0) return;
    wasBusy.current = false;
    let cancelled = false;
    void (async () => {
      for (const delay of FOLLOW_DELAYS) {
        await sleep(delay);
        if (cancelled) return;
        const answers = await Promise.all(
          latest.current.sent.map(async (entry) => ({
            entry,
            items:
              (
                await client
                  .fetchQuery({
                    queryKey: queryKey(entry),
                    queryFn: () => getFollowups(entry),
                    staleTime: 0,
                  })
                  .catch(() => null)
              )?.items ?? [],
          })),
        );
        if (cancelled) return;
        for (const { entry, items } of answers) {
          const [nextId] = queuedAnswers(items, latest.current.messages);
          if (nextId != null) {
            await latest.current.followAnswer({ agentId: entry.agentId, messageId: nextId });
            return;
          }
        }
        if (!answers.some(({ items }) => hasWaiting(items))) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [busy, client]);

  const onEvent = followups.onEvent;

  return {
    // Steering is offered while an answer runs and its number is known.
    canSteer: busy && target != null && modes.length > 0,
    modes,
    send,
    onEvent: onEvent as (event: AgUiEvent) => void,
    notes,
  };
}
