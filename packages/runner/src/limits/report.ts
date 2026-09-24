import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { UsageLimitSnapshot } from '@helena/sdk';
import { claudeProbes } from './claude';
import { codexProbes } from './codex';
import { dedupe, LimitProber, limitProber } from './index';

// Two commands of the runner's binary that read plan limits outside the agent loop:
//
// `limits-report`: the owner reporter. Run by a systemd timer as the owner
// (deployment/volition-stack/native/limits), it reads the plan limits of the owner's own
// Claude Code and Codex logins with the owner's own CLIs and writes the snapshots — numbers
// only — into Helena's spool, which the API reads. The logins never leave the owner's home.
//
// `limits-probe`: what the runner would answer for one agent's runtime, printed; for the
// proof after a deploy (run as the runtime's user).

export interface SpoolFile {
  version: 1;
  reporter: string;
  reportedAt: string;
  snapshots: UsageLimitSnapshot[];
}

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at >= 0) return argv[at + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function options(argv: string[], name: string): string[] {
  const found: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === name && argv[index + 1]) found.push(argv[index + 1]!);
    else if (arg.startsWith(`${name}=`)) found.push(arg.slice(name.length + 1));
  });
  return found;
}

// Written next to its final name and renamed, so the API never reads half a file. 0644: the
// file holds numbers only, and the API runs as another user.
export async function writeSpool(path: string, file: SpoolFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(file)}\n`, { mode: 0o644 });
  await rename(temp, path);
}

export async function ownerSnapshots(
  env: Record<string, string> = process.env as Record<string, string>,
  log: (line: string) => void = (line) => console.error(line),
): Promise<UsageLimitSnapshot[]> {
  const home = env.HOME ?? homedir();
  const codexHome = env.CODEX_HOME ?? join(home, '.codex');
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? null;
  const probes = [
    ...(await claudeProbes({ env }, claudeDir, 'owner', { home, cwd: home })),
    ...(await codexProbes({ home: codexHome, env }, 'owner')),
  ];
  const prober = new LimitProber(
    { list: () => [{ id: 'owner', label: 'Owner', providers: [], probes: () => probes }] },
    Date.now,
    log,
  );
  return prober.read({ runtime: 'owner', home, env, providers: [] });
}

export async function limitsReport(argv: string[]): Promise<void> {
  const out = option(argv, '--out');
  const snapshots = dedupe(await ownerSnapshots());
  const file: SpoolFile = {
    version: 1,
    reporter: option(argv, '--reporter') ?? 'owner',
    reportedAt: new Date().toISOString(),
    snapshots,
  };
  if (out) await writeSpool(out, file);
  else process.stdout.write(`${JSON.stringify(file, null, 2)}\n`);
  console.error(
    `[helena-limits] ${snapshots.length} account(s): ${snapshots
      .map((snapshot) => `${snapshot.provider}/${snapshot.plan ?? '-'}`)
      .join(', ')}`,
  );
}

export async function limitsProbe(argv: string[]): Promise<void> {
  const runtime = option(argv, '--runtime') ?? 'hermes';
  const home = option(argv, '--home') ?? process.env.HERMES_HOME ?? homedir();
  const snapshots = await limitProber.read(
    {
      runtime,
      home,
      env: process.env as Record<string, string>,
      providers: options(argv, '--provider'),
    },
    { force: true },
  );
  process.stdout.write(`${JSON.stringify({ snapshots }, null, 2)}\n`);
}
