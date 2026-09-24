#!/usr/bin/env bun
/**
 * Writes the steps file that runs the browser build of prove-hermes-sync in a signed-in Helena
 * tab with the headless driver (tools/hl.mjs on the orchestrator's Mac): open Helena, load the
 * bundle, run the proof, print the report. No API key is involved.
 *
 *   bun deployment/volition-stack/scripts/prove-hermes-sync.browser-steps.ts --out=<steps.json> \
 *     [--project=VOL] [--runtimes=hermes,claude,codex] [--model-hermes=gpt-5.6-luna] \
 *     [--reasoning-hermes=low] [--model-claude=haiku] [--reasoning-claude=low] \
 *     [--model-codex=gpt-5.6-luna] [--reasoning-codex=low] [--timeout-min=20] \
 *     [--no-grant-login] [--remove-agents]
 *
 * Claude Code and Codex need their runtime installed (install-cli-runtimes.sh) and a
 * Laufzeit-Anmeldung in Zugänge, which the proof grants to its test agent.
 *   HL_PROFILE=proof node tools/hl.mjs <steps.json>
 *
 * The last step's value is the report: { passed, failed, skipped, checks, evidence }.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const value = (name: string) =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = value('out');
if (!out) {
  console.error('--out=<steps.json> is required');
  process.exit(2);
}

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, 'prove-hermes-sync.browser.ts')],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!built.success) {
  console.error(built.logs.map(String).join('\n'));
  process.exit(1);
}
const bundle = await built.outputs[0]!.text();

const RUNTIMES = ['hermes', 'claude', 'codex'] as const;
const runtimes = (value('runtimes') ?? 'hermes')
  .split(',')
  .filter((name): name is (typeof RUNTIMES)[number] =>
    (RUNTIMES as readonly string[]).includes(name),
  );
const models: Record<string, { model: string | null; reasoning: string | null }> = {};
for (const runtime of RUNTIMES) {
  const model = value(`model-${runtime}`);
  const reasoning = value(`reasoning-${runtime}`);
  if (model || reasoning) models[runtime] = { model: model ?? null, reasoning: reasoning ?? null };
}
const options = {
  project: value('project') ?? 'VOL',
  runtimes,
  ...(Object.keys(models).length > 0 && { models }),
  timeoutMin: Number(value('timeout-min') ?? 20),
  grantLogin: !argv.includes('--no-grant-login'),
  removeAgents: argv.includes('--remove-agents'),
};

const steps = [
  { goto: '/', settle: 4000 },
  // Loads the bundle; `helenaHermesProof` is a global of the tab from then on.
  { eval: `(() => { ${bundle}; return typeof helenaHermesProof; })()` },
  { eval: `helenaHermesProof.run(${JSON.stringify(options)})` },
];
writeFileSync(out, JSON.stringify(steps));
console.log(`${out}: ${steps.length} steps, bundle ${Math.round(bundle.length / 1024)} KB`);
