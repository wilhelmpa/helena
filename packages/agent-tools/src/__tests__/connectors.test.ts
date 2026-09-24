import { describe, expect, test } from 'bun:test';
import { toMcpTool } from '@helena/sdk';
import { INTEGRATIONS } from '../registry';
import { TOOL_CATEGORIES } from '../categories';
import { builtinConnectors } from '../connectors';

describe('integrations as connectors', () => {
  test('every tool has an action category, and no category names a tool that is gone', () => {
    const keys = INTEGRATIONS.flatMap((integration) => integration.tools.map((tool) => tool.key));
    expect(keys.filter((key) => !TOOL_CATEGORIES[key])).toEqual([]);
    expect(Object.keys(TOOL_CATEGORIES).filter((key) => !keys.includes(key))).toEqual([]);
  });

  test('each tool becomes an MCP tool of its connector, with its credential', () => {
    const connectors = builtinConnectors();
    expect(connectors.map((connector) => connector.id)).toEqual(INTEGRATIONS.map((i) => i.key));
    const telegram = connectors.find((connector) => connector.id === 'telegram')!;
    const send = telegram.tools!.find((tool) => tool.name === 'telegram_send')!;
    expect(send.category).toBe('send');
    expect(send.connector).toBe('telegram');
    const mcp = toMcpTool(send);
    expect(mcp.inputSchema.type).toBe('object');
    expect(mcp.annotations?.openWorldHint).toBe(true);
  });
});
