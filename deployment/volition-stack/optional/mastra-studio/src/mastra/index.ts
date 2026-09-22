import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { workflowRegistry } from './registry.ts';

export const mastra = new Mastra({
  workflows: workflowRegistry,
  storage: new LibSQLStore({
    id: 'control-plane',
    url: process.env.STUDIO_DATABASE_URL ?? 'file:/data/studio.db',
  }),
  server: {
    host: '127.0.0.1',
    port: 4112,
    studioBase: '/mastra',
    apiPrefix: '/mastra/api',
    cors: false,
    build: { swaggerUI: false, openAPIDocs: false, apiReqLogs: false },
  },
});
