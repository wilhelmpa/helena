import { readlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  isNewerVersion,
  type UpdateCandidate,
  type UpdateCheckContext,
  type UpdateProgress,
  type UpdateSource,
} from '@helena/sdk';
import { changelogBetween } from '../feeds';
import { readHelperStatus, sendHelperRequest } from '../helper';
import {
  GITHUB_HOSTS,
  NPM_HOST,
  OSV_HOST,
  githubNotes,
  hostInventory,
  npmLatest,
  osvAffected,
  plainVersion,
} from './vendors';
import { getUpdateSettings } from '../settings';

// Claude Code, Codex and the two ACP adapters, installed pinned by install-cli-runtimes.sh
// (/opt/helena/runtimes/<runtime>/<version>, `current` the one in use). The newest version
// is the vendor's: Claude Code's release bucket, npm for the others. An update is done by
// the root helper (`helena-update` → its root-owned copy of `install-cli-runtimes.sh upgrade`), which verifies
// Claude Code's signed manifest with the pinned release key and installs npm packages from a
// fresh lockfile without install scripts; the version before stays for rollback.

export const CLI_RUNTIMES_SOURCE_ID = 'cli-runtimes';
const CLAUDE_RELEASES = 'downloads.claude.ai';

interface RuntimeInfo {
  runtime: string;
  name: string;
  // The npm package, for the npm runtimes.
  npm?: string;
  repository: string;
}

export const CLI_RUNTIMES: RuntimeInfo[] = [
  { runtime: 'claude', name: 'Claude Code', repository: 'anthropics/claude-code' },
  { runtime: 'codex', name: 'Codex CLI', npm: '@openai/codex', repository: 'openai/codex' },
  {
    runtime: 'claude-agent-acp',
    name: 'Claude Code ACP-Adapter',
    npm: '@agentclientprotocol/claude-agent-acp',
    repository: 'agentclientprotocol/claude-agent-acp',
  },
  {
    runtime: 'codex-acp',
    name: 'Codex ACP-Adapter',
    npm: '@agentclientprotocol/codex-acp',
    repository: 'agentclientprotocol/codex-acp',
  },
];

function runtimePrefix(): string {
  return process.env.HELENA_RUNTIME_PREFIX?.trim() || '/opt/helena/runtimes';
}

// The version `current` points at: the helper's inventory when there is one, else the link
// itself (the layout is world-readable).
async function installedVersion(
  context: UpdateCheckContext,
  runtime: string,
): Promise<string | null> {
  const inventory = await hostInventory(context);
  const reported = plainVersion(inventory?.runtimes?.[runtime]?.current);
  if (reported) return reported;
  try {
    return plainVersion(basename(await readlink(join(runtimePrefix(), runtime, 'current'))));
  } catch {
    return null;
  }
}

async function newestVersion(
  context: UpdateCheckContext,
  info: RuntimeInfo,
): Promise<string | null> {
  if (info.npm) return npmLatest(context, info.npm);
  const { claudeChannel } = await getUpdateSettings();
  return plainVersion(
    await context.fetchText(`https://${CLAUDE_RELEASES}/claude-code-releases/${claudeChannel}`, {
      maxBytes: 1024,
    }),
  );
}

async function checkOne(context: UpdateCheckContext, info: RuntimeInfo): Promise<UpdateCandidate> {
  const base = {
    component: info.runtime,
    name: info.name,
    sourceUrl: `https://github.com/${info.repository}`,
    notesUrl:
      info.runtime === 'claude'
        ? 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'
        : `https://github.com/${info.repository}/releases`,
    data: { runtime: info.runtime },
  };
  const installed = await installedVersion(context, info.runtime);
  let available: string | null = null;
  let error: string | null = null;
  try {
    available = await newestVersion(context, info);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const updateAvailable = isNewerVersion(available, installed);
  const security =
    updateAvailable && info.npm && installed
      ? await osvAffected(context, info.npm, installed)
      : false;
  const helper = (await hostInventory(context)) !== null;
  return {
    ...base,
    installed,
    available,
    updateAvailable,
    security,
    applicable: helper && installed !== null,
    hint: installed === null ? { i18n: 'updates.hints.notInstalled' } : null,
    error,
  };
}

export async function helperProgress(ref: string): Promise<UpdateProgress> {
  const status = await readHelperStatus(ref);
  if (!status) return { state: 'running' };
  if (status.state === 'running') return { state: 'running', log: status.log ?? null };
  return {
    state: status.ok ? 'done' : 'failed',
    log: status.log ?? null,
    error: status.ok ? null : (status.error ?? 'The update failed'),
    result: status.result ?? null,
  };
}

export const cliRuntimesSource: UpdateSource = {
  id: CLI_RUNTIMES_SOURCE_ID,
  label: { i18n: 'updates.sources.cliRuntimes' },
  kind: 'runtime',
  order: 20,
  hosts: [CLAUDE_RELEASES, NPM_HOST, OSV_HOST, ...GITHUB_HOSTS],
  async check(context) {
    return Promise.all(CLI_RUNTIMES.map((info) => checkOne(context, info)));
  },
  async releaseNotes(candidate, context) {
    const info = CLI_RUNTIMES.find((entry) => entry.runtime === candidate.component);
    if (!info || !candidate.available) return null;
    if (info.runtime === 'claude') {
      const markdown = await context.fetchText(
        'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
        { maxBytes: 1024 * 1024 },
      );
      return changelogBetween(markdown, candidate.installed, candidate.available);
    }
    return githubNotes(context, info.repository, candidate.installed, candidate.available);
  },
  async apply(request) {
    const info = CLI_RUNTIMES.find((entry) => entry.runtime === request.component);
    if (!info) throw new Error(`Unknown runtime ${request.component}`);
    const ref = await sendHelperRequest('cli-runtime', {
      runtime: info.runtime,
      version: request.target,
    });
    return { ref };
  },
  progress: (ref) => helperProgress(ref),
};
