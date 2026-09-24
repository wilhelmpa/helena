'use client';

import { useFormatter } from 'next-intl';
import { formatTime } from '@/utils/dates';
import type { PlanUIMessage } from '../../utils/chatMessages';

// When a message was written, always visible next to its actions (old-chat parity).
export function ChatMessageTime({ message }: { message: PlanUIMessage }) {
  const at = message.metadata?.createdAt;
  if (!at) return null;
  return (
    <time dateTime={at} className="px-1 text-xs text-muted-foreground tabular-nums">
      {formatTime(at)}
    </time>
  );
}

// What an answer ran on and what it took — the model, the time, the tokens — once the
// server has recorded them (see usePlanChat's refresh after an answer ends). Quiet and
// only on hover, like the actions next to it.
export default function ChatMessageMeta({ message }: { message: PlanUIMessage }) {
  const format = useFormatter();
  const meta = message.metadata;
  const tokens = (meta?.inputTokens ?? 0) + (meta?.outputTokens ?? 0);
  const parts = [
    meta?.model ?? null,
    meta?.durationMs != null
      ? format.number(meta.durationMs / 1000, {
          maximumFractionDigits: 1,
          style: 'unit',
          unit: 'second',
          unitDisplay: 'narrow',
        })
      : null,
    tokens > 0 ? `${format.number(tokens, { notation: 'compact' })} tok` : null,
  ].filter((part): part is string => part != null);
  if (parts.length === 0) return null;

  return (
    <span
      dir="ltr"
      className="ms-1 truncate font-mono text-xs font-normal text-muted-foreground/80 opacity-0 transition-opacity group-hover/message:opacity-100"
    >
      {parts.join(' · ')}
    </span>
  );
}
