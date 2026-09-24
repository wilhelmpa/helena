#!/usr/bin/env bun
/**
 * setup-agent-pool.ts — brings Helena's agent pool into a team, and reads it back out.
 *
 * The pool is a Helena template bundle: bundles/agent-pool (agents/*.md, skills/,
 * .mcp.json, helena.bundle.json; format in scripts/helena-bundle.ts, decision in
 * docs/helena-decisions/template-bundles.md). Import and export go through Helena's own
 * HTTP API (scripts/helena-bundle-sync.ts), never the database. The steps that only fit
 * this installation live in setup-agent-pool.ops.ts.
 *
 *   bun deployment/volition-stack/scripts/setup-agent-pool.ts [options]
 *
 *   --bundle=<dir|file.json>   the bundle to import (default: bundles/agent-pool)
 *   --sections=a,b             bundle (default), report (default), and on request:
 *                              agents  approved skill/MCP additions to running agents
 *                              copies  project copies of templates
 *                              org     coordinator skills and the family department
 *                              goals   roadmap goals
 *   --dry-run                  write nothing, print what would happen
 *   --update                   write the bundle over templates/skills that differ
 *   --check                    validate the bundle only (no API, no key)
 *   --pack=<file.json>         write the bundle as one JSON document (no API, no key)
 *   --export=<dir|file.json>   read the team's templates into a bundle; --agents=a,b
 *                              limits it (the pool bundle fills in what the team
 *                              does not store: descriptions, licenses)
 *   --base-url=<url>           default http://localhost:3000
 *   --team-id=<id>             default: the caller's first team
 *
 * The API needs a personal API key (Helena → Konto → API-Schlüssel) in HELENA_API_KEY;
 * it is sent as the x-api-key header and never printed. Without a key, run the browser
 * build from a signed-in Helena tab instead (setup-agent-pool.browser.ts):
 *
 *   bun build deployment/volition-stack/scripts/setup-agent-pool.browser.ts \
 *     --target=browser --format=iife --outfile=<file>
 *   then, in the tab:  await helenaAgentPool.run({ bundle, dryRun: true })
 *   where `bundle` is the --pack output.
 *
 * Every agent Helena creates gets its own API key in the answer; it is dropped unread (a
 * template never runs, so its key reaches no project).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle, type TemplateBundle } from '../../../scripts/helena-bundle.ts';
import { readBundle, writeBundleDir } from '../../../scripts/helena-bundle-files.ts';
import { exportBundle, keyTransport, SyncLog, resolveTeam } from '../../../scripts/helena-bundle-sync.ts';
import { runAgentPool, type Section } from './setup-agent-pool.ops.ts';

const DEFAULT_BUNDLE = join(import.meta.dir, '..', '..', '..', 'bundles', 'agent-pool');

function checked(bundle: TemplateBundle): TemplateBundle {
  const problems = validateBundle(bundle);
  if (problems.length > 0) throw new Error(`Invalid bundle:\n- ${problems.join('\n- ')}`);
  return bundle;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const bundle = checked(readBundle(value('bundle') ?? DEFAULT_BUNDLE));

  if (args.includes('--check')) {
    console.log(
      `${bundle.name} ${bundle.version}: ${bundle.agents.length} agents, ${bundle.skills.length} skills, ` +
        `${Object.keys(bundle.mcpServers).length} MCP servers — valid.`,
    );
    return;
  }
  const pack = value('pack');
  if (pack) {
    writeFileSync(pack, `${JSON.stringify(bundle, null, 2)}\n`);
    console.log(`Wrote ${pack}`);
    return;
  }

  const apiKey = process.env.HELENA_API_KEY;
  if (!apiKey) {
    console.error(
      'HELENA_API_KEY is not set. Create a personal API key in Helena (Konto → API-Schlüssel), ' +
        'or run the browser build from a signed-in Helena tab (see the header of this file).',
    );
    process.exit(1);
  }
  const send = keyTransport(value('base-url') ?? 'http://localhost:3000', apiKey);
  const teamId = value('team-id') ? Number(value('team-id')) : undefined;

  const target = value('export');
  if (target) {
    const log = new SyncLog(send, { dryRun: true, update: false }, (line) => console.log(line));
    const exported = await exportBundle(log, await resolveTeam(log, teamId), {
      agents: value('agents')?.split(','),
      known: bundle,
    });
    if (target.endsWith('.json')) writeFileSync(target, `${JSON.stringify(exported, null, 2)}\n`);
    else writeBundleDir(exported, target);
    const problems = validateBundle(exported);
    console.log(`Wrote ${target}${problems.length ? `; to fix before sharing:\n- ${problems.join('\n- ')}` : ''}`);
    return;
  }

  const result = await runAgentPool(
    {
      bundle,
      dryRun: args.includes('--dry-run'),
      update: args.includes('--update'),
      sections: value('sections')?.split(',').map((s) => s.trim()) as Section[] | undefined,
      teamId,
    },
    send,
    (line) => console.log(line),
  );
  if (result.warnings > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error('\nsetup-agent-pool failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
