import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';

export type TimelineItem =
  | { kind: 'entry'; entry: AgentActivityEntry }
  | {
      kind: 'heartbeats';
      // Stable while the bundle's newest run stays the same.
      key: string;
      agent: AgentActivityEntry['agent'];
      entries: AgentActivityEntry[];
    };

// A finished run its agent's heartbeat started (owner, I: the history was mostly TRADE
// heartbeats every 15 minutes). A running or failed one is not routine and stays visible.
export function isRoutineHeartbeat(entry: Pick<AgentActivityEntry, 'trigger' | 'status'>): boolean {
  return entry.trigger === 'heartbeat' && entry.status === 'success';
}

// The timeline with the routine heartbeats bundled: a stretch of them in a row becomes one
// row per agent ("12 Herzschläge"), in the place of the newest one; a single one stays a
// row of its own.
export function bundleHeartbeats(items: AgentActivityEntry[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let stretch: AgentActivityEntry[] = [];
  const flush = () => {
    const byAgent = new Map<string, AgentActivityEntry[]>();
    for (const entry of stretch) {
      const key = String(entry.agent?.id ?? 'none');
      byAgent.set(key, [...(byAgent.get(key) ?? []), entry]);
    }
    for (const entries of byAgent.values())
      out.push(
        entries.length === 1
          ? { kind: 'entry', entry: entries[0]! }
          : {
              kind: 'heartbeats',
              key: `heartbeats:${entries[0]!.id}`,
              agent: entries[0]!.agent,
              entries,
            },
      );
    stretch = [];
  };
  for (const entry of items) {
    if (isRoutineHeartbeat(entry)) stretch.push(entry);
    else {
      flush();
      out.push({ kind: 'entry', entry });
    }
  }
  flush();
  return out;
}

// The tasks a bundle of heartbeats worked on, each once, newest first.
export function bundleTasks(entries: AgentActivityEntry[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => (entry.issue ? [entry.issue.identifier] : []))),
  ];
}
