import { expect, test } from 'bun:test';
import { HalogenHealthGate } from './health';

test('waits until health reports no active or queued request', async () => {
  let probes = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      probes += 1;
      return Response.json(
        probes === 1
          ? { busy: true, in_flight: 1, queued: 0 }
          : { busy: false, in_flight: 0, queued: 0 },
      );
    },
  });
  try {
    const gate = new HalogenHealthGate(`http://127.0.0.1:${server.port}/health`);
    await gate.waitIdle();
    expect(probes).toBe(2);
  } finally {
    server.stop(true);
  }
});

test('marks overlapping model traffic during a case', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ busy: true, in_flight: 2, queued: 0 }),
  });
  try {
    const gate = new HalogenHealthGate(`http://127.0.0.1:${server.port}/health`);
    const stop = gate.watchCase();
    await Bun.sleep(2200);
    await stop();
    expect(gate.contaminationCount).toBe(1);
  } finally {
    server.stop(true);
  }
});
