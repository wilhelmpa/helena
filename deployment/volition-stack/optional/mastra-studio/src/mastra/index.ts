import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { workflowRegistry } from './registry.ts';

const workflows = process.env.MASTRA_FRESH_MODE === 'true' ? {} : workflowRegistry;

export const mastra = new Mastra({
  workflows,
  storage: new LibSQLStore({
    id: 'control-plane',
    url: process.env.STUDIO_DATABASE_URL ?? 'file:/data/studio.db',
  }),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.MASTRA_UPSTREAM_PORT ?? 4112),
    studioBase: '/mastra',
    apiPrefix: '/mastra/api',
    cors: false,
    build: { swaggerUI: false, openAPIDocs: false, apiReqLogs: false },
  },
});

// Continues the runs that were active when the process stopped, each from the step it
// was in. The built server does not do this, only `mastra dev` does, and Mastra's
// restartAllActiveWorkflowRuns() waits for each run to finish before it restarts the
// next. A stage that runs again replays the Plan run of its idempotency key.
export async function restartActiveRuns(instance: Mastra): Promise<void> {
  const { runs } = await instance.listActiveWorkflowRuns();
  await Promise.all(
    runs.map(async ({ workflowName, runId }) => {
      try {
        await (await instance.getWorkflowById(workflowName).createRun({ runId })).restart();
      } catch (error) {
        instance.getLogger().error('Failed to restart workflow run', { workflowName, runId, error });
      }
    }),
  );
}

restartActiveRuns(mastra).catch((error) =>
  mastra.getLogger().error('Failed to restart active workflow runs', { error }),
);
