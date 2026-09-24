// Browser build of setup-agent-pool.ts: runs the same pool setup with the signed-in
// Helena session of the tab it is evaluated in, no API key. Build and use:
//   bun build deployment/volition-stack/scripts/setup-agent-pool.browser.ts \
//     --target=browser --format=iife --outfile=/tmp/helena-agent-pool.js
//   (in a Helena tab)  await helenaAgentPool.run({ dryRun: true })
import { runAgentPool, sessionTransport, type PoolOptions } from './setup-agent-pool.ts';

(globalThis as { helenaAgentPool?: unknown }).helenaAgentPool = {
  run: (options: PoolOptions = {}) =>
    runAgentPool(options, sessionTransport(), (line) => console.log(line)),
};
