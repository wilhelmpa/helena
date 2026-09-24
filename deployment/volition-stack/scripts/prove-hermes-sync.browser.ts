// Browser build of prove-hermes-sync: runs the proof in a signed-in Helena tab with that
// session and no API key, through the web app's /backend proxy. It proves Hermes, Claude Code
// and Codex on the server's own runner (new agent online by itself, runtime installed and
// signed in, one real run with instruction, skill and MCP markers, the model check; for
// Hermes also an edit reaching the agent and "Neu schreiben"). What needs a process on the
// server (reading SOUL.md with sudo, --tamper) is reported as skipped; prove-hermes-sync.ts
// does those.
//
// Build the steps for the headless driver (tools/hl.mjs), then run it:
//   bun deployment/volition-stack/scripts/prove-hermes-sync.browser-steps.ts \
//     --out=<steps.json> [--project=VOL] [--runtimes=hermes,claude,codex] \
//     [--model-hermes=gpt-5.6-luna --reasoning-hermes=low] [--model-claude=haiku ...]
//   HL_PROFILE=proof node tools/hl.mjs <steps.json>
// Or by hand, in a Helena tab after loading the bundle:
//   await helenaHermesProof.run({ project: 'VOL', runtimes: ['hermes', 'claude', 'codex'] })
import { sessionTransport } from '../../../scripts/helena-bundle-sync.ts';
import { runProof, type ProofOptions, type ProofReport } from './prove-hermes-sync.ops.ts';

(globalThis as { helenaHermesProof?: unknown }).helenaHermesProof = {
  run: (options: ProofOptions = {}): Promise<ProofReport> =>
    runProof({ runtimes: ['hermes'], ...options }, sessionTransport(), null, (line) =>
      console.log(line),
    ),
};
