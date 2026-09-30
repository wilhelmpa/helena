import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { helperProgress } from './sources/cli-runtimes';

test('completion requires the matching runtime, service or speech smoke proof', async () => {
  const spool = await mkdtemp(join(tmpdir(), 'volition-progress-test-'));
  const prior = process.env.HELENA_UPDATE_SPOOL;
  process.env.HELENA_UPDATE_SPOOL = spool;
  await mkdir(join(spool, 'status'));
  try {
    for (const action of ['cli-runtime', 'host-tool', 'apt', 'whisper-ui']) {
      const id = randomUUID();
      const status = { id, action, state: 'done', ok: true, result: {} };
      await writeFile(join(spool, 'status', `${id}.json`), JSON.stringify(status));
      expect((await helperProgress(id)).state).toBe('failed');
      status.result =
        action === 'whisper-ui' ? { speechVerified: true, phase: 'active' } : { smoke: 'passed' };
      await writeFile(join(spool, 'status', `${id}.json`), JSON.stringify(status));
      expect((await helperProgress(id)).state).toBe('done');
      status.state = 'failed';
      await writeFile(join(spool, 'status', `${id}.json`), JSON.stringify(status));
      expect((await helperProgress(id)).state).toBe('failed');
    }
  } finally {
    if (prior === undefined) delete process.env.HELENA_UPDATE_SPOOL;
    else process.env.HELENA_UPDATE_SPOOL = prior;
    await rm(spool, { recursive: true, force: true });
  }
});
