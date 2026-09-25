import type { Client, ReflectionReport, ReflectionRequest, ReflectionSaved, Run } from './client';
import type { RunnerConfig } from './config';
import { execute, modelProvider } from './execute';
import type { HermesRunSettings } from './policy';
import { runEnv } from './run';
import { SpendReader } from './spend';
import { runCwd } from './workdir';

// A reflection continues the session of a finished run with the prompt Helena sent. The
// agent keeps what the run taught it with its memory and skill tools and has no other
// tool, so the turn cannot do more work. Its tokens are reported to Helena, which adds them
// to the run's. Helena may name another model for it: a local one (its local AI takes the
// reflection of a small session), whose provider the profile lists while local AI is on; the
// profile's fallback chain starts with the agent's own model, which answers if it fails.

const REFLECTION_TOOLSETS = ['memory', 'skills'];
const SAVED_TOOLS: Record<string, ReflectionSaved['tool']> = {
  memory: 'memory',
  skill_manage: 'skill',
};
const MAX_SAVED = 50;
const MAX_SUMMARY = 2000;
// Past its budget Hermes ends the turn itself; the runner stops it after this much more.
const GRACE_MS = 60_000;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Reads the memory and skill writes of the turn off Hermes' stream-json: a tool_use line
// with the call's input, then the tool_result line of the same call. A write Hermes
// refused, or kept as a proposal, is not counted as saved.
export class ReflectionReader {
  private line = '';
  private readonly calls = new Map<string, ReflectionSaved>();
  readonly saved: ReflectionSaved[] = [];

  write(chunk: string): void {
    const lines = chunk.split('\n');
    for (let index = 0; index < lines.length; index++) {
      this.line += lines[index];
      if (index < lines.length - 1) this.end();
    }
  }

  end(): void {
    const line = this.line;
    this.line = '';
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const tool = SAVED_TOOLS[String(value?.name)];
    if (!tool) return;
    const key = typeof value.tool_call_id === 'string' ? value.tool_call_id : String(value.name);
    if (value.type === 'tool_use') {
      const input = (value.input ?? {}) as Record<string, unknown>;
      const action = text(input.action, 40) || (Array.isArray(input.operations) ? 'batch' : '');
      const target =
        tool === 'memory' ? text(input.target, 200) || 'memory' : text(input.name, 200);
      this.calls.set(key, { tool, action: action || 'write', target });
      return;
    }
    if (value.type !== 'tool_result') return;
    const call = this.calls.get(key);
    this.calls.delete(key);
    const output = typeof value.output === 'string' ? value.output : '';
    const refused = /"success"\s*:\s*false/.test(output) || /"staged"\s*:\s*true/.test(output);
    if (call && value.is_error !== true && !refused && this.saved.length < MAX_SAVED) {
      this.saved.push(call);
    }
  }
}

// Never throws for the reflection itself: a failed turn is reported as failed. Only the
// report to Plan can throw.
export async function reflect(
  config: RunnerConfig,
  client: Client,
  run: Run,
  sessionId: string,
  request: ReflectionRequest,
  hermes: HermesRunSettings,
): Promise<ReflectionReport> {
  const toolsets =
    hermes.toolsets === null
      ? REFLECTION_TOOLSETS
      : REFLECTION_TOOLSETS.filter((name) => hermes.toolsets!.includes(name));
  let report: ReflectionReport;
  if (toolsets.length === 0) {
    report = { status: 'failed', saved: [], error: 'The agent has no memory or skill tools' };
  } else {
    const reader = new ReflectionReader();
    // The model Helena named, with no reasoning level of the run's (the local provider says
    // how its turns think), or the run's own.
    const model = request.model ?? run.model;
    const thinkingLevel = request.model ? null : run.thinkingLevel;
    const spend = new SpendReader(
      config.outputFormat,
      config.command ? null : (config.agent ?? null),
    );
    const outcome = await execute(
      {
        ...config,
        cwd: runCwd(config.cwd, run.workdir),
        timeoutMs: Math.min(config.timeoutMs, request.runBudgetSeconds * 1000 + GRACE_MS),
      },
      {
        prompt: request.prompt,
        systemPrompt: '',
        sessionId,
        model,
        thinkingLevel,
        maxTurns: request.maxTurns,
        runBudgetSeconds: request.runBudgetSeconds,
        toolsets,
        env: { ...runEnv(run), ...hermes.env },
        hooks: hermes.hooks,
      },
      {
        onData: (chunk) => {
          reader.write(chunk);
          spend.write(chunk);
        },
        work: { kind: 'run', id: run.id },
      },
    );
    reader.end();
    report = {
      status: outcome.status,
      usage: outcome.usage ?? null,
      spend: spend.value({ model, provider: modelProvider(config, model) ?? null }),
      saved: reader.saved,
      summary: outcome.output.trim().slice(0, MAX_SUMMARY) || null,
      ...(outcome.error && { error: outcome.error.slice(0, 500) }),
    };
  }
  await client.reportReflection(run.id, report);
  return report;
}
