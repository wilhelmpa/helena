import { expect, test } from 'bun:test';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { routeTools, mcpTool } from '../../generate';
import type { McpApp } from '../../types';

test('a body union retains every discriminator and its conditional required fields', () => {
  const app = {
    routes: [
      {
        method: 'POST',
        path: '/things/:id',
        hooks: {
          detail: mcpTool('ABSCHLUSSTEST'),
          body: {
            anyOf: [
              {
                type: 'object',
                properties: { mode: { const: 'move' }, targetId: { type: 'integer' } },
                required: ['mode', 'targetId'],
              },
              { type: 'object', properties: { mode: { const: 'delete' } }, required: ['mode'] },
            ],
          },
        },
      },
    ],
  } as unknown as McpApp;
  const tool = routeTools(app)[0]!;
  const validator = new AjvJsonSchemaValidator();
  const check = validator.getValidator(
    tool.inputSchema as Parameters<typeof validator.getValidator>[0],
  );
  expect(check({ id: '214', mode: 'move', targetId: 1 }).valid).toBe(true);
  expect(check({ id: '214', mode: 'delete' }).valid).toBe(true);
  expect(check({ id: '214', mode: 'move' }).valid).toBe(false);
  expect(check({ id: '214', mode: 'unknown' }).valid).toBe(false);
});
