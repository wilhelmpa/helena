import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// A member's own delivery preferences for a project, per issue event and channel.

const OFF = { assigned: false, mentioned: false, commented: false, state_changed: false };

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return asOwner;
}

const preferencesOf = (api: Api) => api.projects({ projectKey: 'MKT' })['notification-preferences'];

describe('notification preferences', () => {
  beforeEach(resetDb);

  it('starts with every event off, the approval request included', async () => {
    const preferences = preferencesOf(await setup());
    expect((await preferences.get()).data).toEqual({
      emailEvents: { ...OFF, approval_requested: false },
      telegramEvents: { ...OFF, approval_requested: false },
    });
  });

  it('keeps the approval request toggle when a client leaves it out', async () => {
    const preferences = preferencesOf(await setup());
    const saved = await preferences.put({
      emailEvents: { ...OFF, approval_requested: true },
      telegramEvents: { ...OFF, mentioned: true },
    });
    expect(saved.data!.emailEvents.approval_requested).toBe(true);

    const again = await preferences.put({
      emailEvents: { ...OFF, assigned: true },
      telegramEvents: { ...OFF, mentioned: true },
    });
    expect(again.data!.emailEvents).toEqual({ ...OFF, assigned: true, approval_requested: true });
    expect((await preferences.get()).data!.emailEvents.approval_requested).toBe(true);
  });
});
