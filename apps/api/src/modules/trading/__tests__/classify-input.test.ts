import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { routeTools } from '#mcp/generate';
import { mcpTool } from '#mcp/generate';
import { assertClassificationShape, classificationInput } from '../classify-input';
import { classifyBody } from '../model';

const route = new Elysia().post('/classify', ({ body }) => classificationInput(body), {
  body: classifyBody,
  detail: mcpTool('trading_classify'),
  transform: ({ body }) => assertClassificationShape(body),
});
const app = new Elysia().use(route);
const publicBody = {
  kind: 'news',
  publicNews: {
    articleText: 'Synthetic issuer publishes annual results.',
    instruments: ['DEMO'],
    publicDataConfirmed: true,
  },
};
async function call(body: unknown) {
  return app.handle(
    new Request('http://localhost/classify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('trading public input contract', () => {
  it('legacy callers retain their context but cannot permit cloud', async () => {
    for (const kind of ['news', 'rule', 'routing']) {
      const response = await call({
        kind,
        context: 'Private synthetic account context',
        rule: 'Synthetic rule',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        context: 'Private synthetic account context',
        localOnly: true,
        rule: 'Synthetic rule',
      });
    }
  });
  it('constructs the public payload only from article text and instrument names', async () => {
    const response = await call(publicBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      context: { articleText: publicBody.publicNews.articleText, instruments: ['DEMO'] },
      localOnly: false,
    });
  });
  it('refuses absent confirmation, false confirmation, mixed private context and foreign fields', async () => {
    for (const body of [
      { kind: 'news', publicNews: { articleText: 'Synthetic article', instruments: ['DEMO'] } },
      { ...publicBody, publicNews: { ...publicBody.publicNews, publicDataConfirmed: false } },
      { ...publicBody, context: 'Private balance' },
      { ...publicBody, chatMessageId: 123 },
      { ...publicBody, publicNews: { ...publicBody.publicNews, positions: ['Private position'] } },
      { ...publicBody, kind: 'rule' },
    ])
      expect([400, 422]).toContain((await call(body)).status);
  });
  it('advertises all legacy kinds and the separate public input to MCP', () => {
    const schema = routeTools(app)[0]!.inputSchema;
    expect(JSON.stringify(schema.properties.kind)).toContain('routing');
    expect(schema.properties.publicNews).toBeDefined();
    expect(schema.required).toEqual(['kind']);
    expect(schema.properties.chatMessageId).toBeUndefined();
  });
});
