import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import { Elysia, t } from 'elysia';
import { oneOf } from '#shared/schemas';

// Schemas take choices through oneOf (#shared/schemas), never t.UnionEnum: Elysia gives a
// UnionEnum its first value as the default and fills it into a request field that is left
// out, whether the field is optional, required, nullable, inside t.Partial or reached through
// a variable. Responses are not filled in, but they use oneOf too, so the rule has no
// exception to get wrong.
const src = `${import.meta.dir}/../../..`;

describe('choice schemas', () => {
  it('build t.UnionEnum nowhere but in oneOf', async () => {
    const offenders: string[] = [];
    for await (const file of new Glob('**/*.ts').scan({ cwd: src })) {
      if (file === 'shared/schemas.ts') continue;
      if (file.includes('__tests__') || file.endsWith('.test.ts')) continue;
      const text = await Bun.file(`${src}/${file}`).text();
      if (/\bt\s*\.\s*UnionEnum\s*\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('oneOf is an enum without a default', () => {
    const mode = oneOf(['open', 'invite', 'closed'], { description: 'Who may sign up.' });
    expect(mode).toMatchObject({
      type: 'string',
      enum: ['open', 'invite', 'closed'],
      description: 'Who may sign up.',
    });
    expect('default' in mode).toBe(false);
  });

  it('leaves out what a request leaves out and refuses a missing required choice', async () => {
    const mode = oneOf(['open', 'invite', 'closed']);
    const app = new Elysia()
      .post('/optional', ({ body }) => body, {
        body: t.Object({ mode: t.Optional(mode), flag: t.Boolean() }),
      })
      .post('/partial', ({ body }) => body, {
        body: t.Partial(t.Object({ mode, flag: t.Boolean() })),
      })
      .post('/nullable', ({ body }) => body, {
        body: t.Object({ mode: t.Optional(t.Nullable(mode)), flag: t.Boolean() }),
      })
      .post('/required', ({ body }) => body, { body: t.Object({ mode, flag: t.Boolean() }) })
      .get('/query', ({ query }) => query, { query: t.Object({ mode: t.Optional(mode) }) });
    const post = (path: string, body: unknown) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    for (const path of ['/optional', '/partial', '/nullable']) {
      const res = await post(path, { flag: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ flag: true });
    }
    expect((await post('/required', { flag: true })).status).toBe(422);
    expect((await post('/required', { mode: 'everyone', flag: true })).status).toBe(422);
    expect(await (await post('/required', { mode: 'invite', flag: true })).json()).toEqual({
      mode: 'invite',
      flag: true,
    });
    expect(await (await app.handle(new Request('http://localhost/query'))).json()).toEqual({});
  });
});
