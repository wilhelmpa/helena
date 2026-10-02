import { beforeEach, expect, test } from 'bun:test';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

beforeEach(resetDb);
for (const [method, path] of [
  ['GET', '/imports/not-a-uuid'],
  ['POST', '/imports/not-a-uuid/confirm'],
  ['POST', '/imports/not-a-uuid/cancel'],
  ['DELETE', '/attachments/not-a-uuid'],
  ['POST', '/projects/ABSCHLUSSTEST/imports'],
] as const) {
  test(`${method} ${path}: malformed UUID is a 400`, async () => {
    const owner = await signUpTestUser();
    await authedApi(owner.cookie).projects.post({ key: 'ABSCHLUSSTEST', name: 'ABSCHLUSSTEST' });
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        ...(method === 'POST'
          ? {
              body: JSON.stringify(
                path.endsWith('/imports')
                  ? { attachmentId: 'not-a-uuid', mapping: { title: 'ABSCHLUSSTEST' } }
                  : {},
              ),
            }
          : {}),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
}
