#!/usr/bin/env bun
/**
 * Writes the steps file that runs the browser build of prove-hermes-sync in a signed-in Helena
 * tab with the headless driver (tools/hl.mjs on the orchestrator's Mac): open Helena, load the
 * bundle, run the proof, print the report. No API key is involved.
 *
 *   bun deployment/volition-stack/scripts/prove-hermes-sync.browser-steps.ts --out=<steps.json> \
 *     [--project=VOL] [--model-hermes=gpt-5.6-luna] [--reasoning-hermes=low] [--timeout-min=20] \
 *     [--remove-agents]
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

const model = value('model-hermes');
const reasoning = value('reasoning-hermes');
const options = {
  project: value('project') ?? 'VOL',
  runtimes: ['hermes'],
  ...((model || reasoning) && {
    models: { hermes: { model: model ?? null, reasoning: reasoning ?? null } },
  }),
  timeoutMin: Number(value('timeout-min') ?? 20),
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
