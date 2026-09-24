import { describe, expect, test } from 'bun:test';
import { intEnv, startLoop } from './index';

describe('startLoop', () => {
  test('ticks again after each tick and survives a failing one', async () => {
    let ticks = 0;
    const handle = startLoop(
      'test',
      async () => {
        ticks += 1;
        if (ticks === 1) throw new Error('first tick fails');
      },
      () => 5,
    );
    await Bun.sleep(40);
    handle.stop();
    const stoppedAt = ticks;
    expect(stoppedAt).toBeGreaterThan(2);
    await Bun.sleep(20);
    expect(ticks).toBe(stoppedAt);
  });
});

describe('intEnv', () => {
  test('reads a positive number and falls back otherwise', () => {
    process.env.HELENA_LOOP_TEST = '250';
    expect(intEnv('HELENA_LOOP_TEST', 7)).toBe(250);
    for (const value of ['', '0', '-3', 'abc']) {
      process.env.HELENA_LOOP_TEST = value;
      expect(intEnv('HELENA_LOOP_TEST', 7)).toBe(7);
    }
    delete process.env.HELENA_LOOP_TEST;
    expect(intEnv('HELENA_LOOP_TEST', 7)).toBe(7);
  });
});
