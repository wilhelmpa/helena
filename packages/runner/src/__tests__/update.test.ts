import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeUpdate } from '../update';

// The runner writes update requests into the spool the root helper watches and reads its
// status back; the helper itself is tested in deployment/volition-stack/native/hermes-update.

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function spool() {
  const dir = await mkdtemp(join(tmpdir(), 'helena-update-'));
  dirs.push(dir);
  return dir;
}

describe('runtime update', () => {
  it('writes an apply request and returns at once', async () => {
    const dir = await spool();
    const answer = (await runtimeUpdate(
      { op: 'runtime.update', action: 'apply', target: 'v2026.9.28' },
      dir,
    )) as { id: string; state: string };
    expect(answer.state).toBe('started');
    const request = JSON.parse(await readFile(join(dir, 'request.json'), 'utf8'));
    expect(request).toEqual({ id: answer.id, action: 'apply', target: 'v2026.9.28' });
  });

  it('waits for the helper to answer a check', async () => {
    const dir = await spool();
    const checking = runtimeUpdate({ op: 'runtime.update', action: 'check' }, dir);
    // The helper takes the request and writes its status.
    await Bun.sleep(200);
    const request = JSON.parse(await readFile(join(dir, 'request.json'), 'utf8'));
    await writeFile(
      join(dir, 'status.json'),
      JSON.stringify({
        id: request.id,
        state: 'done',
        ok: true,
        result: { latest: { version: '0.22.0' } },
      }),
    );
    expect(await checking).toEqual({ latest: { version: '0.22.0' } });
  });

  it('reads the status, idle before any request', async () => {
    const dir = await spool();
    expect(await runtimeUpdate({ op: 'runtime.update', action: 'status' }, dir)).toEqual({
      id: null,
      state: 'idle',
    });
  });
});
