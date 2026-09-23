import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import {
  emptyMcpServerValue,
  isMcpServerFormValid,
  mcpServerValue,
  presetValue,
  toMcpServerInput,
  type McpServerFormValue,
} from './mcpServerForm';

const secrets = [
  { id: 3, integrationKey: 'secret', kind: 'secret' as const, label: 'OTHER' },
  { id: 9, integrationKey: 'secret', kind: 'secret' as const, label: 'TYPESAFE_API_KEY' },
];

describe('MCP server presets', () => {
  it('starts Shopify Dev MCP with npx and no credentials', () => {
    const value = presetValue('shopify-dev', 'Docs', secrets);
    assert.equal(isMcpServerFormValid(value), true);
    assert.deepEqual(toMcpServerInput(value), {
      name: 'shopify-dev',
      description: 'Docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@shopify/dev-mcp@latest'],
      url: null,
      env: [],
      headers: [],
    });
  });

  it('takes the Jev Browser key from the secret of the same name', () => {
    const value = presetValue('jev-browser', 'Browser', secrets);
    assert.deepEqual(toMcpServerInput(value), {
      name: 'jev-browser',
      description: 'Browser',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@jkudish/jev-browser'],
      url: null,
      env: [{ name: 'TYPESAFE_API_KEY', credentialId: 9 }],
      headers: [],
    });
  });

  it('asks for the secret while the team has none of that name', () => {
    const value = presetValue('jev-browser', '', []);
    assert.equal(value.env[0]?.credentialId, null);
    assert.equal(isMcpServerFormValid(value), false);
  });
});

describe('MCP server form', () => {
  const stdio = (patch: Partial<McpServerFormValue>): McpServerFormValue => ({
    ...emptyMcpServerValue(),
    name: 'tool',
    command: 'npx',
    ...patch,
  });

  it('needs a name Hermes can use and what the transport starts', () => {
    assert.equal(isMcpServerFormValid(stdio({})), true);
    assert.equal(isMcpServerFormValid(stdio({ name: 'My Tool' })), false);
    assert.equal(isMcpServerFormValid(stdio({ command: ' ' })), false);
    const remote = stdio({ transport: 'http', command: '' });
    assert.equal(isMcpServerFormValid(remote), false);
    assert.equal(isMcpServerFormValid({ ...remote, url: 'ftp://host' }), false);
    assert.equal(isMcpServerFormValid({ ...remote, url: 'https://mcp.example.com' }), true);
  });

  it('refuses a literal Hermes would expand, and a name set twice', () => {
    const row = { name: 'KEY', secret: false, value: 'x', credentialId: null };
    assert.equal(isMcpServerFormValid(stdio({ env: [row] })), true);
    assert.equal(isMcpServerFormValid(stdio({ env: [{ ...row, value: '${HOME}' }] })), false);
    assert.equal(isMcpServerFormValid(stdio({ args: '--token=${X}' })), false);
    assert.equal(isMcpServerFormValid(stdio({ env: [row, row] })), false);
    assert.equal(isMcpServerFormValid(stdio({ env: [{ ...row, name: '1KEY' }] })), false);
  });

  it('sends only what the transport uses', () => {
    const value = stdio({
      transport: 'sse',
      url: ' https://mcp.example.com/sse ',
      args: '-y\n\n pkg ',
      env: [{ name: 'KEY', secret: false, value: 'x', credentialId: null }],
      headers: [{ name: 'Authorization', secret: true, value: '', credentialId: 3 }],
    });
    assert.deepEqual(toMcpServerInput(value), {
      name: 'tool',
      description: '',
      transport: 'sse',
      command: null,
      args: [],
      url: 'https://mcp.example.com/sse',
      env: [],
      headers: [{ name: 'Authorization', credentialId: 3 }],
    });
    assert.deepEqual(toMcpServerInput({ ...value, transport: 'stdio' }).args, ['-y', 'pkg']);
  });

  it('edits a stored server with its secrets as picked rows, a deleted one unpicked', () => {
    const server: McpServer = {
      id: 1,
      teamId: 2,
      name: 'jev-browser',
      description: '',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@jkudish/jev-browser'],
      url: null,
      env: [
        { name: 'TYPESAFE_API_KEY', value: null, credentialId: 9, credentialLabel: 'TS' },
        { name: 'MODE', value: 'fast', credentialId: null, credentialLabel: null },
        { name: 'GONE', value: null, credentialId: 4, credentialLabel: null },
      ],
      headers: [],
      createdAt: '2026-09-23T00:00:00.000Z',
    };
    const value = mcpServerValue(server);
    assert.equal(value.args, '-y\n@jkudish/jev-browser');
    assert.deepEqual(value.env, [
      { name: 'TYPESAFE_API_KEY', secret: true, value: '', credentialId: 9 },
      { name: 'MODE', secret: false, value: 'fast', credentialId: null },
      { name: 'GONE', secret: true, value: '', credentialId: null },
    ]);
    // A deleted secret has to be picked again.
    assert.equal(isMcpServerFormValid(value), false);
    value.env.pop();
    assert.deepEqual(toMcpServerInput(value).env, [
      { name: 'TYPESAFE_API_KEY', credentialId: 9 },
      { name: 'MODE', value: 'fast' },
    ]);
  });
});
