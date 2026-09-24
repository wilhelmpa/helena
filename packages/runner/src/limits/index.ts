import {
  createRegistry,
  normalizeUsageLimitSnapshot,
  type UsageLimitAgentContext,
  type UsageLimitObserver,
  type UsageLimitSnapshot,
  type UsageLimitSource,
} from '@helena/sdk';
import { claudeLimitSource } from './claude';
import { codexLimitSource } from './codex';
import { hermesLimitSource } from './hermes';

export { claudeLimitSource, claudeObserver, claudeProbes } from './claude';
export { codexAppServerRequest, codexLimitSource, codexProbes } from './codex';
export { hermesLimitSource, hermesLoginStore } from './hermes';

// The usage-limit sources this runner knows (@helena/sdk UsageLimitSource): the built-ins,
// registered as the internal plugin `helena.limits`, and those of the plugins its config
// names (plugins.ts).

export const BUILTIN_LIMITS_PLUGIN = 'helena.limits';

export const limitSources = createRegistry<UsageLimitSource>('usage-limit source');
for (const source of [hermesLimitSource, codexLimitSource, claudeLimitSource]) {
  limitSources.register(source, BUILTIN_LIMITS_PLUGIN);
}

function servesRuntime(source: UsageLimitSource, runtime: string): boolean {
  return !source.runtimes || source.runtimes.includes(runtime);
}

// Whether any source reads the limits of this runtime's logins, for the capability the
// runtime status reports.
export function limitsCapable(runtime: string | undefined): boolean {
  if (!runtime) return false;
  return limitSources
    .list()
    .some((source) => servesRuntime(source, runtime) && (!!source.probes || !!source.observe));
}

// ── Probing, once per login ─────────────────────────────────────────────────────────────

interface Entry {
  at: number;
  snapshots: UsageLimitSnapshot[];
  pending: Promise<UsageLimitSnapshot[]> | null;
}

// How long a probe's answer is reused: every agent on one login asks within the same
// minute of Helena's interval, and they share one request to the provider.
export const LIMITS_CACHE_MS = 4 * 60_000;
// A forced read ("Aktualisieren") still asks the provider at most once a minute per login.
export const LIMITS_FORCE_FLOOR_MS = 60_000;

export class LimitProber {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly sources: { list(): UsageLimitSource[] } = limitSources,
    private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = () => {},
  ) {}

  // The snapshots of every login the agent's runtime can see, probed or from the cache.
  async read(
    context: UsageLimitAgentContext,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<UsageLimitSnapshot[]> {
    const probes = (
      await Promise.all(
        this.sources
          .list()
          .filter((source) => source.probes && servesRuntime(source, context.runtime))
          .map(async (source) => {
            try {
              return await source.probes!(context);
            } catch (error) {
              this.log(`limits: ${source.id} offered no probe — ${message(error)}`);
              return [];
            }
          }),
      )
    ).flat();
    const results = await Promise.all(
      probes.map(async (probe) => {
        const entry = this.entries.get(probe.key);
        const age = entry ? this.now() - entry.at : Infinity;
        const fresh = age < (options.force ? LIMITS_FORCE_FLOOR_MS : LIMITS_CACHE_MS);
        if (entry?.pending) return entry.pending;
        if (entry && fresh) return entry.snapshots;
        const pending = probe
          .run(options.signal)
          .then((found) =>
            found
              .map((snapshot) => normalizeUsageLimitSnapshot(snapshot))
              .filter((snapshot): snapshot is UsageLimitSnapshot => snapshot !== null),
          )
          .catch((error: unknown) => {
            this.log(`limits: ${probe.provider} probe failed — ${message(error)}`);
            return entry?.snapshots ?? [];
          });
        this.entries.set(probe.key, {
          at: entry?.at ?? 0,
          snapshots: entry?.snapshots ?? [],
          pending,
        });
        const snapshots = await pending;
        this.entries.set(probe.key, { at: this.now(), snapshots, pending: null });
        return snapshots;
      }),
    );
    return dedupe(results.flat());
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

// One snapshot per provider and account: the newest.
export function dedupe(snapshots: UsageLimitSnapshot[]): UsageLimitSnapshot[] {
  const byAccount = new Map<string, UsageLimitSnapshot>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.provider}\u0000${snapshot.account}`;
    const known = byAccount.get(key);
    if (!known || Date.parse(snapshot.observedAt) > Date.parse(known.observedAt)) {
      byAccount.set(key, snapshot);
    }
  }
  return [...byAccount.values()];
}

// The runner's one prober: the agents it serves share its cache. It logs to stderr, so the
// limits-probe command's output stays the JSON alone.
export const limitProber = new LimitProber(limitSources, Date.now, (line) =>
  console.error(`[itsaplan-runner] ${line}`),
);

// ── Reading a run's output ──────────────────────────────────────────────────────────────

// How often a run's changed limits are sent while it goes; the last ones always are.
export const OBSERVE_POST_MS = 60_000;

// Feeds a run's or chat answer's output to every source that reads the runtime's output
// format, and sends what changed to Helena: when a window's state or a rounded share moves,
// at most once a minute, and once when the command ended. Never throws.
export class LimitsStream {
  private buffered = '';
  private readonly latest = new Map<string, UsageLimitSnapshot>();
  private readonly sentAt = new Map<string, number>();
  private readonly dirty = new Set<string>();

  constructor(
    private readonly observers: UsageLimitObserver[],
    private readonly post: (snapshots: UsageLimitSnapshot[]) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  write(chunk: string): void {
    if (this.observers.length === 0) return;
    this.buffered += chunk;
    const lines = this.buffered.split('\n');
    this.buffered = lines.pop() ?? '';
    for (const line of lines) this.read(line);
    this.send(false);
  }

  async end(): Promise<void> {
    if (this.buffered) this.read(this.buffered);
    this.buffered = '';
    await this.send(true);
  }

  private read(line: string): void {
    for (const observer of this.observers) {
      let found: UsageLimitSnapshot[] = [];
      try {
        found = observer.line(line);
      } catch {
        continue;
      }
      for (const raw of found) {
        const snapshot = normalizeUsageLimitSnapshot(raw);
        if (!snapshot) continue;
        const key = `${snapshot.provider}\u0000${snapshot.account}`;
        this.latest.set(key, snapshot);
        this.dirty.add(key);
      }
    }
  }

  private send(final: boolean): Promise<void> {
    const due = [...this.dirty].filter(
      (key) => final || this.now() - (this.sentAt.get(key) ?? -Infinity) >= OBSERVE_POST_MS,
    );
    if (due.length === 0) return Promise.resolve();
    for (const key of due) {
      this.dirty.delete(key);
      this.sentAt.set(key, this.now());
    }
    const snapshots = due.map((key) => this.latest.get(key)!);
    try {
      return Promise.resolve(this.post(snapshots)).then(
        () => {},
        () => {},
      );
    } catch {
      // A client that cannot send them loses the numbers, never the run.
      return Promise.resolve();
    }
  }
}

// The stream for one command of an agent, or null where no source reads its output.
export function limitsStream(
  format: string,
  context: UsageLimitAgentContext,
  post: (snapshots: UsageLimitSnapshot[]) => Promise<unknown>,
): LimitsStream | null {
  const observers = limitSources
    .list()
    .filter((source) => source.observe && servesRuntime(source, context.runtime))
    .map((source) => {
      try {
        return source.observe!(format, context);
      } catch {
        return null;
      }
    })
    .filter((observer): observer is UsageLimitObserver => observer !== null);
  return observers.length > 0 ? new LimitsStream(observers, post) : null;
}

// ── The profile helper's side ───────────────────────────────────────────────────────────

// `limits.read` answered where only the runtime's home is known: in the profile helper of
// an isolated agent, which runs as the project's user with the agent's profile bound in.
// The runner fills in the providers; a Claude Code or Codex home holds its runtime's own
// directory.
export async function answerLimitsRead(
  request: { force?: boolean; providers?: string[] },
  context: { runtime: string; home: string; env: Record<string, string> },
): Promise<{ snapshots: UsageLimitSnapshot[] }> {
  const runtimeDir =
    context.runtime === 'claude'
      ? (context.env.CLAUDE_CONFIG_DIR ?? `${context.home}/.claude`)
      : context.runtime === 'codex'
        ? (context.env.CODEX_HOME ?? `${context.home}/.codex`)
        : context.home;
  const snapshots = await limitProber.read(
    {
      runtime: context.runtime,
      home: runtimeDir,
      env: context.env,
      providers: (request.providers ?? []).filter((provider) => typeof provider === 'string'),
    },
    { force: request.force === true },
  );
  return { snapshots };
}
