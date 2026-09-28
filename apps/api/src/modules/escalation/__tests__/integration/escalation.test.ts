import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// The escalation rules as the Administrator reads and changes them (a Phase 2 draft).

afterAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe('escalation rules', () => {
  it('are the Administrator’s, off by default, and change part by part', async () => {
    const owner = authedApi((await signUpTestUser({ name: 'Owner' })).cookie);
    const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
    expect((await member.god.escalation.get()).status).toBe(403);
    expect((await member.god.escalation.put({ enabled: true })).status).toBe(403);

    const first = await owner.god.escalation.get();
    expect(first.status).toBe(200);
    expect(first.data!.enabled).toBe(false);

    const changed = await owner.god.escalation.put({
      kinds: [{ kind: 'legal', enabled: false, model: null }],
      uncertainty: { threshold: 0.7 },
      pins: [{ scope: 'agent', id: 3, mode: 'local', model: null }],
    });
    expect(changed.status).toBe(200);
    expect(changed.data!.enabled).toBe(false);
    expect(changed.data!.kinds.find((entry) => entry.kind === 'legal')?.enabled).toBe(false);
    expect(changed.data!.kinds.find((entry) => entry.kind === 'coding')?.enabled).toBe(true);
    expect(changed.data!.uncertainty).toMatchObject({ enabled: true, threshold: 0.7 });
    expect(changed.data!.pins).toEqual([{ scope: 'agent', id: 3, mode: 'local', model: null }]);

    expect((await owner.god.escalation.put({ uncertainty: { threshold: 2 } })).status).toBe(400);
    expect((await owner.god.escalation.get()).data!.uncertainty.threshold).toBe(0.7);
  });
});
