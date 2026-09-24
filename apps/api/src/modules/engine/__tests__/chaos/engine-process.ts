import { launchEngine } from '#modules/engine/dbos';
import { engineMaintenance, engineTick } from '#modules/engine/janitor';

// One replica of the engine for the chaos tests (engine-chaos.test.ts): it launches the
// engine against the test database of the parent (DATABASE_URL, HELENA_ENGINE_EXECUTOR_ID
// from the environment), runs the engine's passes the api's background jobs run, and
// says "ready" on stdout. The test kills it with SIGKILL.

async function every(ms: number, pass: () => Promise<unknown>): Promise<never> {
  for (;;) {
    await pass().catch((error: unknown) => {
      console.error('[engine-process]', error instanceof Error ? error.message : error);
    });
    await Bun.sleep(ms);
  }
}

await launchEngine();
process.stdout.write('ready\n');
void every(200, engineTick);
void every(500, engineMaintenance);
