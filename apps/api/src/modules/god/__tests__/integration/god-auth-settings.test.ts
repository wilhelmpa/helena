import { beforeEach, describe, expect, it } from 'bun:test';
import { resetDb } from '#tests/helpers/db';
import { setup } from '../helpers';

describe('auth settings', () => {
  beforeEach(resetDb);

  // Elysia's t.UnionEnum defaults to its first value ("open"), so a partial update used to
  // open registration whenever it left the field out.
  it('keeps registration when a partial update leaves it out', async () => {
    const { god } = await setup();
    expect((await god.api.god['auth-settings'].put({ registration: 'closed' })).status).toBe(200);

    const res = await god.api.god['auth-settings'].put({ magicLink: false });

    expect(res.status).toBe(200);
    expect(res.data?.registration).toBe('closed');
    expect((await god.api.god['auth-settings'].get()).data?.registration).toBe('closed');
  });

  it('refuses a registration mode it does not know', async () => {
    const { god } = await setup();
    const res = await god.api.god['auth-settings'].put({
      registration: 'everyone' as unknown as 'open',
    });
    expect(res.status).toBe(400);
  });
});
