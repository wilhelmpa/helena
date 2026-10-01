import type { AgentRuntimeConfig, ModelServer } from '@helena/agent-runtime';
import {
  contextFileLimit,
  effectiveContextLimits,
  localProviderWithoutThinking,
  priorityProxyBaseUrl,
  truncateContext,
} from '@helena/sdk';
import { readerCapabilities } from './readers';
import type { RunnerConfig } from './config';
import { collectProfile, mcpSecretVariable, type CollectedProfile } from './contributions';
import { digest } from './files';
import { isolationEnabled } from './isolation';
import type { WorkRef } from './logins';
import type { RuntimeActionResult } from './learning';
import type { RuntimePolicyClient, RuntimePolicySnapshot, RuntimeStatus } from './policy';
import { localKeyVariables } from './local-ai';
import {
  profileDigest,
  type McpServerSpec,
  type ProfileReport,
  type RunSettings,
  type RuntimeAdapter,
  type RuntimeDefaults,
  type SessionFacts,
} from './runtime';

// Helena's own agent loop (runtime `helena`, packages/agent-runtime) behind the runtime
// adapter interface. There is no profile on disk to keep in line and nothing to drift: the
// adapter reads the agent's policy from Helena and hands the loop its whole configuration
// with each command, inside the task's JSON on stdin (RunSettings.input). The loop keeps its
// sessions, memory and facts in Helena itself.

const CHECK_INTERVAL_MS = 60_000;

// API-key providers the loop drives itself, each when its key is delivered to the agent.
// Subscriptions stay with Claude Code and Codex (docs/helena-decisions/hermes-bewertung.md §4).
export const KEY_PROVIDERS: ModelServer[] = [
  { provider: 'anthropic', kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', contextLength: 200_000 },
  {
    provider: 'openai',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    contextLength: 200_000,
  },
  {
    provider: 'openrouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    contextLength: 200_000,
  },
];

// Helena's local model servers (snapshot.localAi), each also under its provider without
// thinking, which a reasoning of `none` routes to (local-ai.ts localRoute).
export function localServers(snapshot: RuntimePolicySnapshot): ModelServer[] {
  const servers: ModelServer[] = [];
  for (const server of snapshot.localAi?.servers ?? []) {
    const base = {
      kind: 'openai-compatible' as const,
      keyEnv: server.keyEnv,
      contextLength: server.contextLength,
      thinkingSwitch: true,
      local: true,
    };
    const address = (url: string) => (isolationEnabled() ? url : priorityProxyBaseUrl(url));
    servers.push({ ...base, provider: server.provider, baseUrl: address(server.baseUrl) });
    servers.push({
      ...base,
      provider: localProviderWithoutThinking(server.provider),
      baseUrl: address(server.noThinkingBaseUrl ?? server.baseUrl),
      thinking: false,
    });
  }
  return servers;
}

function instructionsOf(snapshot: RuntimePolicySnapshot) {
  const limits = effectiveContextLimits(
    snapshot.contextLimits,
    snapshot.runtimePolicy.contextLimits,
  );
  const provider = snapshot.model?.split('/')[0];
  const model = snapshot.model?.split('/').slice(1).join('/');
  const local = snapshot.localAi?.servers.find((server) => server.provider === provider);
  const window =
    local?.models.find((entry) => entry.id === model)?.contextLength ??
    local?.contextLength ??
    KEY_PROVIDERS.find((server) => server.provider === provider)?.contextLength ??
    131_072;
  const warnings: string[] = [];
  const text = snapshot.runtimePolicy.files
    .filter((file) => file.kind === 'instructions')
    .map((file) => {
      const key =
        file.path === 'SOUL.md'
          ? 'soul'
          : file.path.includes('project')
            ? 'projectInstructions'
            : file.path.includes('agent')
              ? 'agentInstructions'
              : 'teamInstructions';
      const cut = truncateContext(
        file.content.trim(),
        contextFileLimit(
          window,
          limits[key],
          snapshot.contextOverrides?.[key] !== undefined ||
            snapshot.runtimePolicy.contextLimits?.[key] !== undefined,
        ),
      );
      if (cut.truncated)
        warnings.push(`${file.path}: truncated ${cut.charsBefore} to ${cut.charsAfter} characters`);
      return cut.content;
    })
    .join('\n\n');
  return { text, warnings };
}

// The loop's configuration for one agent (packages/agent-runtime config.ts). The model of a
// run comes on its command line (`--model`, the model Helena chose for the run); this is the
// agent's own.
export function helenaAgentConfig(
  snapshot: RuntimePolicySnapshot,
  specs: McpServerSpec[],
  runner: Pick<RunnerConfig, 'url' | 'cwd'>,
): Omit<AgentRuntimeConfig, 'workdir'> & { workdir?: string } {
  const helena = snapshot.helena ?? {};
  const context = instructionsOf(snapshot);
  const limits = effectiveContextLimits(
    snapshot.contextLimits,
    snapshot.runtimePolicy.contextLimits,
  );
  const fallbacks = snapshot.hermes?.fallbackModels ?? [];
  const subscription = fallbacks.find((entry) =>
    ['openai-codex', 'claude-code'].includes(entry.provider),
  );
  return {
    model: snapshot.model ?? '',
    fallbackModels: fallbacks
      .filter((entry) => !['openai-codex', 'claude-code'].includes(entry.provider))
      .map((entry) => `${entry.provider}/${entry.model}`),
    ...(subscription && {
      runtimeFallback: `runtime:${subscription.provider === 'openai-codex' ? 'codex' : 'claude'}/${subscription.model}`,
    }),
    servers: [...localServers(snapshot), ...KEY_PROVIDERS],
    ...(helena.localModelQueueSeconds !== undefined && {
      limits: { localModelQueueSeconds: helena.localModelQueueSeconds },
    }),
    instructions: context.text,
    contextWarnings: context.warnings,
    contextLimits: limits,
    ...(runner.cwd && { workdir: runner.cwd }),
    helena: { url: runner.url, apiKeyEnv: 'ITSAPLAN_API_KEY' },
    mcpServers: specs,
    tools: {
      profile: helena.toolProfile ?? 'assistent',
      ...(helena.coreTools && { core: helena.coreTools }),
      ...(helena.browserBudgetSeconds && { browserBudgetSeconds: helena.browserBudgetSeconds }),
    },
    skills: (snapshot.skills ?? []).map((skill) => ({
      name: skill.slug,
      displayName: skill.name,
      description: (skill.description || skill.name).slice(0, limits.skillDescription),
      markdown: skill.markdown,
      files: skill.files,
    })),
    memory: { enabled: snapshot.learning?.enabled !== false },
    ...(helena.escalation && { escalation: helena.escalation }),
    sessions: { store: 'helena' },
    policy: 'helena',
  };
}

interface Applied {
  revision: string;
  snapshot: RuntimePolicySnapshot;
  collected: CollectedProfile;
  secrets: number[];
}

export class HelenaRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'helena';
  private applied: Applied | null = null;
  private checkedAt = -Infinity;
  private active: Promise<void> | null = null;
  private reported: string | null = null;
  private problem: string | null = null;

  constructor(
    private readonly config: RunnerConfig,
    private readonly client: RuntimePolicyClient,
    private readonly now: () => number = Date.now,
  ) {}

  ensure(): Promise<void> {
    this.active ??= this.sync().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  inventoryChanged(): void {
    this.checkedAt = -Infinity;
  }

  // The loop names the model it ran on (the `model` event, read off the stream).
  sessionFacts(): Promise<SessionFacts | null> {
    return Promise.resolve(null);
  }

  defaults(): RuntimeDefaults | null {
    const model = this.applied?.snapshot.model ?? null;
    return model ? { model, provider: model.split('/')[0] ?? null, reasoning: null } : null;
  }

  private async sync(): Promise<void> {
    let snapshot: RuntimePolicySnapshot;
    try {
      snapshot = await this.client.runtimePolicy();
    } catch {
      return;
    }
    const due = this.now() - this.checkedAt >= CHECK_INTERVAL_MS;
    if (snapshot.revision === this.applied?.revision && !due) return;
    this.checkedAt = this.now();
    try {
      const collected = collectProfile({
        runtime: 'helena',
        snapshot,
        url: this.config.url,
        env: this.config.env,
      });
      const secrets = (snapshot.mcpServers ?? [])
        .flatMap((server) => [...server.env, ...server.headers])
        .flatMap((entry) => ('secret' in entry ? [entry.secret] : []));
      this.applied = {
        revision: snapshot.revision,
        snapshot,
        collected,
        secrets: [...new Set(secrets)],
      };
      this.problem = null;
    } catch (error) {
      this.problem = `Runtime policy sync failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`;
    }
    await this.report(snapshot);
  }

  private specs(applied: Applied): McpServerSpec[] {
    const off = new Set([
      ...(applied.snapshot.runtimePolicy.toolDeny ?? []),
      ...applied.collected.suppressed,
    ]);
    return applied.collected.mcpServers.filter((spec) => !off.has(spec.name));
  }

  private profile(applied: Applied): ProfileReport {
    const specs = this.specs(applied);
    return {
      hash: profileDigest({
        revision: applied.revision,
        instructions: digest(instructionsOf(applied.snapshot).text),
        skills: (applied.snapshot.skills ?? []).map((skill) => [
          skill.slug,
          digest(skill.markdown),
        ]),
        servers: specs.map((spec) => spec.name),
        helena: applied.snapshot.helena ?? null,
      }),
      checkedAt: new Date(this.now()).toISOString(),
      drift: [],
      defaults: this.defaults(),
      mcpServers: specs.map((spec) => ({ name: spec.name, enabled: true, managed: true })),
    };
  }

  private async report(snapshot: RuntimePolicySnapshot): Promise<void> {
    const applied = this.applied;
    // The loop's memory is Helena's own: an owner's edit is already where the loop reads it,
    // so a write-memory action is done once Helena records the version (completeMemoryWrites).
    const actions: RuntimeActionResult[] = (snapshot.actions ?? []).map((action) => ({
      id: action.id,
      error:
        action.kind === 'write-memory' || action.kind === 'rewrite-profile'
          ? null
          : 'Skill action was not applied by the native API',
    }));
    const status: RuntimeStatus = {
      adapter: 'helena',
      status: this.problem ? 'degraded' : 'online',
      detail: this.problem,
      appliedRevision: applied?.revision ?? null,
      capabilities: [
        'model',
        'reasoning',
        'managed-skills',
        'learning',
        'managed-mcp-servers',
        'memory',
        ...readerCapabilities('helena'),
      ],
      ...(applied && {
        inventory: {
          toolsets: ['native'],
          mcpServers: applied.collected.runtimeServers,
          skills: (snapshot.skills ?? [])
            .filter((skill) => !skill.slug.startsWith('learned/'))
            .map((skill) => ({
              name: skill.name,
              category: 'helena',
              description: skill.description.slice(0, 300),
              origin: 'plan' as const,
              pinned: false,
            })),
          // The loop reads its memory from Helena itself; reported as it is there, the memory
          // editor shows and edits it like any agent's.
          memory: (snapshot.memoryWrites?.baseline ?? []).map((entry) => ({
            file: entry.file,
            content: entry.content,
            truncated: false,
            sha256: entry.sha256,
            chars: entry.content.length,
          })),
          cronJobs: 0,
        },
        profile: this.profile(applied),
      }),
      version: null,
      issues: [],
      actions,
    };
    const key = digest(
      JSON.stringify({ ...status, profile: { ...status.profile, checkedAt: null } }),
    );
    if (key === this.reported) return;
    try {
      await this.client.reportRuntimeStatus(status);
      this.reported = key;
    } catch {
      // The next check reports again.
    }
  }

  async runSettings(work?: WorkRef): Promise<RunSettings> {
    await this.ensure();
    const applied = this.applied;
    if (!applied) throw new Error(this.problem ?? "Helena's runtime policy is not available yet");
    const env: Record<string, string> = {
      ...(isolationEnabled() && this.config.isolation !== undefined && { HELENA_ISOLATED: '1' }),
    };
    const variables = localKeyVariables(applied.snapshot.localAi);
    if (variables.length > 0 && this.client.modelServerKeys) {
      const keys = await this.client.modelServerKeys();
      for (const name of variables) env[name] = keys[name] ?? '';
    }
    if (applied.secrets.length > 0) {
      const values = await this.client.mcpSecrets(work);
      for (const id of applied.secrets) env[mcpSecretVariable(id)] = values[String(id)] ?? '';
    }
    return {
      toolsets: null,
      env,
      input: { config: helenaAgentConfig(applied.snapshot, this.specs(applied), this.config) },
    };
  }
}
