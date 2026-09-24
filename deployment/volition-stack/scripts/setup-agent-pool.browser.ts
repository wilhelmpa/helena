// Browser build of setup-agent-pool: imports a template bundle into the team of the
// signed-in Helena tab it is evaluated in, and exports one, with that session and no
// API key. Build and use:
//   bun deployment/volition-stack/scripts/setup-agent-pool.ts --pack=<pool.json>
//   bun build deployment/volition-stack/scripts/setup-agent-pool.browser.ts \
//     --target=browser --format=iife --outfile=<pool.js>
//   (in a Helena tab, after loading pool.js)
//   await helenaAgentPool.run({ bundle: <pool.json>, dryRun: true })
//   await helenaAgentPool.export({ known: <pool.json> })   // → TemplateBundle
import type { TemplateBundle } from '../../../scripts/helena-bundle.ts';
import {
  exportBundle,
  resolveTeam,
  sessionTransport,
  SyncLog,
  type ExportOptions,
} from '../../../scripts/helena-bundle-sync.ts';
import { runAgentPool, type PoolRunOptions } from './setup-agent-pool.ops.ts';

(globalThis as { helenaAgentPool?: unknown }).helenaAgentPool = {
  run: (options: PoolRunOptions) =>
    runAgentPool(options, sessionTransport(), (line) => console.log(line)),
  export: async (options: ExportOptions & { teamId?: number } = {}): Promise<TemplateBundle> => {
    const log = new SyncLog(sessionTransport(), { dryRun: true, update: false }, (line) =>
      console.log(line),
    );
    return exportBundle(log, await resolveTeam(log, options.teamId), options);
  },
};
