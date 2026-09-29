import { appendFile } from 'node:fs/promises';

type Health = { busy: boolean; in_flight?: number; queued?: number };

async function command(args: string[]): Promise<string> {
  const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'ignore' });
  const [code, output] = await Promise.all([process.exited, new Response(process.stdout).text()]);
  return code === 0 ? output.trim() : 'unavailable';
}

export class HalogenHealthGate {
  private initialRestarts: number | null = null;
  private lastRequest: { bytes: number; tools: number } | null = null;
  private unavailableSince: number | null = null;
  private hangRecorded = false;
  hangCount = 0;
  contaminationCount = 0;

  constructor(
    private readonly url: string,
    private readonly logFile?: string,
  ) {}

  async start(): Promise<void> {
    const value = Number(
      await command(['systemctl', 'show', 'helena-halogen', '-p', 'NRestarts', '--value']),
    );
    this.initialRestarts = Number.isFinite(value) ? value : null;
  }

  async setRequest(body: unknown): Promise<void> {
    const raw = typeof body === 'string' ? body : '';
    let tools = 0;
    try {
      const parsed = JSON.parse(raw) as { tools?: unknown[] };
      tools = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
    } catch {
      // The upstream request still validates its body.
    }
    this.lastRequest = { bytes: Buffer.byteLength(raw), tools };
    if (this.logFile)
      await this.record({ phase: 'request-ready', busy: false, ...this.lastRequest });
  }

  private async record(event: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    if (this.logFile) await appendFile(this.logFile, line + '\n');
    else process.stderr.write(line + '\n');
  }

  watchCase(): () => Promise<void> {
    let watching = true;
    let reported = false;
    const run = (async () => {
      while (watching) {
        await Bun.sleep(2000);
        if (!watching) break;
        try {
          const response = await fetch(this.url, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) continue;
          const health = (await response.json()) as Health;
          if (!reported && ((health.in_flight ?? 0) > 1 || (health.queued ?? 0) > 0)) {
            reported = true;
            this.contaminationCount += 1;
            await this.record({
              phase: 'contaminated',
              inFlight: health.in_flight,
              queued: health.queued,
            });
          }
        } catch {
          // waitIdle records a sustained health outage after the case.
        }
      }
    })();
    return async () => {
      watching = false;
      await run;
    };
  }

  async waitIdle(): Promise<void> {
    for (;;) {
      try {
        const response = await fetch(this.url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
        const health = (await response.json()) as Health;
        if (this.unavailableSince !== null && this.hangRecorded)
          await this.record({
            phase: 'hang-recovered',
            durationSeconds: Math.round((Date.now() - this.unavailableSince) / 1000),
          });
        this.unavailableSince = null;
        this.hangRecorded = false;
        if (health.busy === false && (health.in_flight ?? 0) === 0 && (health.queued ?? 0) === 0)
          return;
      } catch (error) {
        this.unavailableSince ??= Date.now();
        const elapsed = Date.now() - this.unavailableSince;
        if (elapsed > 60_000 && !this.hangRecorded) {
          this.hangRecorded = true;
          this.hangCount += 1;
          const restarts = Number(
            await command(['systemctl', 'show', 'helena-halogen', '-p', 'NRestarts', '--value']),
          );
          await this.record({
            phase: 'hang',
            durationSeconds: Math.round(elapsed / 1000),
            restarts,
            lastRequest: this.lastRequest,
            free: await command(['free', '-g']),
            topMemory: await command(['bash', '-lc', 'ps -eo rss,comm --sort=-rss | head']),
            error: String(error),
          });
          if (this.initialRestarts !== null && restarts > this.initialRestarts)
            throw new Error('Halogen restarted during the evaluation');
        }
        if (elapsed > 600_000) throw new Error('Halogen health unavailable for ten minutes');
      }
      await Bun.sleep(2000);
    }
  }
}
