import type { RuntimeReaders } from './types';

export const nativeReaders: RuntimeReaders = {
  runtime: 'helena',
  ops: [
    'version.read',
    'sessions.list',
    'sessions.search',
    'sessions.transcript',
    'curator.status',
    'curator.run',
    'curator.set',
  ],
  async handle(request, context) {
    const url = context.env.ITSAPLAN_URL;
    const key = context.env.ITSAPLAN_API_KEY;
    if (!url || !key) throw new Error('The native reader requires its agent API connection');
    const response = await fetch(`${url.replace(/\/+$/, '')}/agent-runtime/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Native reader failed (${response.status})`);
    return response.json();
  },
};
