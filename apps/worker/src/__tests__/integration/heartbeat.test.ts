import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, serviceHeartbeat } from '@repo/db';
import { resetWorkerConfigForTests } from '../../config';
import { recordHeartbeats } from '../../heartbeat';

// The worker reports itself and the provisioning service for the health overview.

async function checks() {
  const rows = await db.select().from(serviceHeartbeat);
  return Object.fromEntries(rows.map((row) => [row.service, row]));
}

describe('worker heartbeat', () => {
  beforeEach(async () => {
    await db.delete(serviceHeartbeat);
    process.env.PROJECT_PROVISIONING_URL = 'http://127.0.0.1:18800/api/provision';
    resetWorkerConfigForTests();
  });
  afterEach(() => {
    delete process.env.PROJECT_PROVISIONING_URL;
    resetWorkerConfigForTests();
  });

  it('records the worker and a provisioning service that answers', async () => {
    const asked: string[] = [];
    await recordHeartbeats(async (url) => {
      asked.push(String(url));
      return new Response('{}');
    });
    const rows = await checks();
    expect(asked).toEqual(['http://127.0.0.1:18800/healthz']);
    expect(rows.worker).toMatchObject({ error: null, lastSeenAt: expect.any(Date) });
    expect(rows.provisioning).toMatchObject({ error: null, lastSeenAt: expect.any(Date) });
  });

  it('keeps the last time the provisioning service answered when it stops answering', async () => {
    await recordHeartbeats(async () => new Response('{}'));
    const seen = (await checks()).provisioning!.lastSeenAt;
    await recordHeartbeats(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await checks()).provisioning).toMatchObject({
      error: 'fetch failed',
      lastSeenAt: seen,
    });
    await recordHeartbeats(async () => new Response('', { status: 503 }));
    expect((await checks()).provisioning).toMatchObject({ error: 'HTTP 503', lastSeenAt: seen });
  });
});
