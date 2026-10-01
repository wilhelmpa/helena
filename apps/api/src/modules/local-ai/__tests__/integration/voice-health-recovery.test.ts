import { beforeEach, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { alertLog, localAiAlertSource } from '#modules/push/sources';
import { checkAllServers, localAiStatus } from '../../service';

beforeEach(resetDb);

it('clears an old Qwen3-TTS connection failure and its alert after the periodic health check', async () => {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const options = {
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ data: [{ id: 'Qwen3-TTS', object: 'model' }] }),
  };
  let voice = Bun.serve(options);
  const port = voice.port;
  try {
    const added = await asOwner.god['local-ai'].servers.post({
      slug: 'volition-test-voice',
      kind: 'qwentts-cpp',
      name: 'Stimme (Qwen3-TTS)',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      keySource: 'none',
    });
    expect(added.status).toBe(200);
    const id = added.data!.id;
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    expect((await localAiStatus()).servers.find((server) => server.id === id)?.reachable).toBe(
      true,
    );
    voice.stop(true);
    await checkAllServers();
    const down = (await localAiStatus()).servers.find((server) => server.id === id)!;
    expect(down.reachable).toBe(false);
    expect(down.error).toContain('Unable to connect');
    expect(await localAiAlertSource.collect({ now: new Date(), log: alertLog })).toEqual([
      expect.objectContaining({ key: `server:${id}` }),
    ]);
    voice = Bun.serve({ ...options, port });
    await checkAllServers();
    const recovered = await asOwner.god['local-ai'].status.get();
    expect(recovered.status).toBe(200);
    expect(recovered.data?.servers.find((server) => server.id === id)).toMatchObject({
      reachable: true,
      error: null,
    });
    expect(await localAiAlertSource.collect({ now: new Date(), log: alertLog })).toEqual([]);
  } finally {
    voice.stop(true);
  }
});
