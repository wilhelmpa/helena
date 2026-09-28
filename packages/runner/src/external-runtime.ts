import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { RuntimePolicySnapshot, WorkRef } from '@helena/sdk';
import { acceptedName } from './agent-env';
import { isolationEnabled } from './isolation';
import type { RunnerConfig } from './config';
import type { RuntimePolicyClient } from './policy';
import type { RunSettings, RuntimeAdapter, RuntimeDefaults, SessionFacts } from './runtime';

export async function projectScript(root: string, name: string, isolated = false): Promise<string> {
  if (
    !name ||
    isAbsolute(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/^[A-Za-z0-9_./-]+$/.test(name)
  ) {
    throw new Error('Command script must be a relative path in the project workspace');
  }
  if (isolated) return join(root, name);
  const [workspace, script] = await Promise.all([realpath(root), realpath(join(root, name))]);
  const inside = relative(workspace, script);
  if (!inside || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) {
    throw new Error('Command script leaves the project workspace');
  }
  if (!(await stat(script)).isFile()) throw new Error('Command script must be a file');
  return script;
}

function webhookSettings(snapshot: RuntimePolicySnapshot): RunSettings {
  const url = snapshot.runtimePolicy.webhookUrl;
  const secretEnv = snapshot.runtimePolicy.webhookSecretEnv;
  if (!url || !secretEnv || !acceptedName(secretEnv)) {
    throw new Error('Webhook URL and signing secret environment variable are required');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Webhook URL must be an HTTPS URL without credentials or fragment');
  }
  return {
    toolsets: null,
    env: { HELENA_WEBHOOK_URL: url, HELENA_WEBHOOK_SECRET_ENV: secretEnv },
    instructions: snapshot.runtimePolicy.files.find((file) => file.path === 'SOUL.md')?.content,
  };
}

export class ExternalRuntimeAdapter implements RuntimeAdapter {
  readonly runtime: 'command' | 'webhook';
  private checked = 0;
  private revision: string | null = null;

  constructor(
    runtime: 'command' | 'webhook',
    private config: RunnerConfig,
    private client: RuntimePolicyClient,
  ) {
    this.runtime = runtime;
  }

  async ensure(): Promise<void> {
    if (Date.now() - this.checked < 60_000) return;
    this.checked = Date.now();
    try {
      const snapshot = await this.client.runtimePolicy();
      if (this.revision === snapshot.revision) return;
      if (this.runtime === 'command') {
        if (!this.config.cwd || !snapshot.runtimePolicy.commandScript) {
          throw new Error('Command script and project workspace are required');
        }
        await projectScript(
          this.config.cwd,
          snapshot.runtimePolicy.commandScript,
          isolationEnabled() && !!this.config.isolation,
        );
      } else {
        webhookSettings(snapshot);
      }
      await this.client.reportRuntimeStatus({
        adapter: this.runtime,
        status: 'online',
        appliedRevision: snapshot.revision,
        capabilities: ['adapter'],
        detail: null,
      });
      this.revision = snapshot.revision;
    } catch (error) {
      await this.client
        .reportRuntimeStatus({
          adapter: this.runtime,
          status: 'degraded',
          appliedRevision: this.revision,
          capabilities: ['adapter'],
          detail:
            error instanceof Error ? error.message.slice(0, 240) : 'Adapter configuration failed',
        })
        .catch(() => {});
    }
  }

  async runSettings(work?: WorkRef): Promise<RunSettings> {
    const snapshot = await this.client.runtimePolicy();
    const reference =
      work && ('runId' in work ? { runId: work.runId } : { messageId: work.messageId });
    if (this.runtime === 'webhook') {
      const settings = webhookSettings(snapshot);
      await this.authorize({
        runtime: 'webhook',
        tool: 'send',
        mcp: { server: 'external-webhook', action: 'send' },
        ...reference,
      });
      return settings;
    }
    if (!this.config.cwd || !snapshot.runtimePolicy.commandScript) {
      throw new Error('Command script and project workspace are required');
    }
    const script = await projectScript(
      this.config.cwd,
      snapshot.runtimePolicy.commandScript,
      isolationEnabled() && !!this.config.isolation,
    );
    await this.authorize({
      runtime: 'command',
      tool: 'shell',
      command: `./${snapshot.runtimePolicy.commandScript}`,
      workspace: this.config.cwd,
      ...reference,
    });
    return {
      toolsets: null,
      env: {},
      args: [script],
      instructions: snapshot.runtimePolicy.files.find((file) => file.path === 'SOUL.md')?.content,
    };
  }

  private async authorize(
    question: Parameters<NonNullable<RuntimePolicyClient['decideRuntime']>>[0],
  ): Promise<void> {
    if (!this.client.decideRuntime) throw new Error('The Autopilot policy endpoint is unavailable');
    const decision = await this.client.decideRuntime(question);
    if (decision.outcome !== 'allow') {
      throw new Error(decision.message || 'Autopilot did not allow this adapter invocation');
    }
  }

  inventoryChanged(): void {}
  async sessionFacts(_sessionId: string | undefined): Promise<SessionFacts | null> {
    return null;
  }
  defaults(): RuntimeDefaults | null {
    return null;
  }
}
