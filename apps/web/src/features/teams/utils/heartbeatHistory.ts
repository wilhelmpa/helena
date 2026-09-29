import type { AgentHeartbeatEvent } from '@/lib/api/endpoints/agents';

export type HeartbeatReason = 'noWork' | 'outsideHours' | 'precheck' | 'runPending' | 'other';

// What a check's reason (the API's words) means for the reader.
export function heartbeatReason(reason: string): HeartbeatReason {
  if (reason === 'no work') return 'noWork';
  if (reason === 'outside work hours') return 'outsideHours';
  if (reason.startsWith('precheck')) return 'precheck';
  if (reason === 'run pending' || reason.startsWith('run pending')) return 'runPending';
  return 'other';
}

export type HeartbeatHistoryItem =
  | { kind: 'queued'; event: AgentHeartbeatEvent }
  | {
      kind: 'skipped';
      reason: HeartbeatReason;
      // The newest and the oldest check of the stretch.
      from: string;
      to: string;
      count: number;
      key: string;
    };

// The agent's last checks as the heartbeat section lists them (owner, Paperclip's heartbeat
// with precheck): a started run as a row of its own; checks in a row that were skipped for
// the same reason as one row, "12× nichts zu tun".
export function heartbeatHistory(events: AgentHeartbeatEvent[]): HeartbeatHistoryItem[] {
  const out: HeartbeatHistoryItem[] = [];
  for (const event of events) {
    if (event.outcome === 'queued') {
      out.push({ kind: 'queued', event });
      continue;
    }
    const reason = heartbeatReason(event.reason);
    const last = out.at(-1);
    if (last?.kind === 'skipped' && last.reason === reason) {
      last.count += 1;
      last.to = event.checkedAt;
      continue;
    }
    out.push({
      kind: 'skipped',
      reason,
      from: event.checkedAt,
      to: event.checkedAt,
      count: 1,
      key: `skipped:${event.id}`,
    });
  }
  return out;
}
