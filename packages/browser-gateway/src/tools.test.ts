import { describe, expect, it } from 'bun:test';
import {
  BROWSER_TOOLS,
  CREDENTIAL_TOOLS,
  categoryOf,
  normalizeArgs,
  requiresLock,
  toolByName,
} from './tools';
import { ACTION_CATEGORIES, mcpToolOf } from './agent-tool';

describe('BROWSER_TOOLS', () => {
  it('has a unique name for every tool', () => {
    const names = BROWSER_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool name is prefixed browser_', () => {
    for (const tool of BROWSER_TOOLS) expect(tool.name.startsWith('browser_')).toBe(true);
  });

  it('offers no free evaluate/JavaScript escape hatch', () => {
    const names = BROWSER_TOOLS.map((tool) => tool.name.toLowerCase());
    for (const forbidden of [
      'evaluate',
      'eval',
      'script',
      'run_code',
      'cookie',
      'storage',
      'route',
      'cdp',
      'close',
      'resize',
    ]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }
  });

  it('every input schema is a plain object schema with additionalProperties false', () => {
    for (const tool of BROWSER_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('every tool accepts the optional Home-Master project override', () => {
    for (const tool of BROWSER_TOOLS) {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('project');
    }
  });
});

describe('toolByName', () => {
  it('finds a known tool', () => {
    expect(toolByName('browser_navigate')?.name).toBe('browser_navigate');
  });

  it('returns undefined for an unknown tool', () => {
    expect(toolByName('browser_evaluate')).toBeUndefined();
  });
});

describe('requiresLock', () => {
  it('does not require the lock for status/acquire/release/handover', () => {
    expect(requiresLock('browser_status')).toBe(false);
    expect(requiresLock('browser_acquire')).toBe(false);
    expect(requiresLock('browser_release')).toBe(false);
    expect(requiresLock('browser_handover')).toBe(false);
  });

  it('requires the lock for every page-touching tool', () => {
    expect(requiresLock('browser_navigate')).toBe(true);
    expect(requiresLock('browser_click')).toBe(true);
    expect(requiresLock('browser_login')).toBe(true);
  });
});

describe('CREDENTIAL_TOOLS', () => {
  it('contains exactly the login and 2FA tools', () => {
    expect([...CREDENTIAL_TOOLS].sort()).toEqual(['browser_login', 'browser_login_code']);
  });
});

describe('action categories (Helena agent tools)', () => {
  it('every tool has one, and reading tools are read', () => {
    for (const tool of BROWSER_TOOLS) expect(ACTION_CATEGORIES).toContain(tool.category);
    for (const name of [
      'browser_status',
      'browser_snapshot',
      'browser_find',
      'browser_take_screenshot',
      'browser_console_messages',
      'browser_network_requests',
      'browser_wait_for',
    ]) {
      expect(toolByName(name)?.category).toBe('read');
    }
    for (const name of ['browser_navigate', 'browser_click', 'browser_type', 'browser_fill_form']) {
      expect(toolByName(name)?.category).toBe('write');
    }
    expect(toolByName('browser_file_upload')?.category).toBe('send');
  });

  it('a click, typed Enter or pressed Enter that submits a form is a send', () => {
    expect(categoryOf(toolByName('browser_click')!, true)).toBe('send');
    expect(categoryOf(toolByName('browser_click')!, false)).toBe('write');
    expect(categoryOf(toolByName('browser_press_key')!, true)).toBe('send');
    expect(categoryOf(toolByName('browser_navigate')!, true)).toBe('write');
  });

  it('are shown to MCP clients as annotations and _meta', () => {
    const listed = mcpToolOf(toolByName('browser_snapshot')!);
    expect(listed.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(listed._meta).toEqual({ 'helena/action': 'read' });
    expect(mcpToolOf(toolByName('browser_click')!).annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(mcpToolOf(toolByName('browser_status')!).annotations.openWorldHint).toBe(false);
  });
});

describe('normalizeArgs', () => {
  it("takes older names and Hermes' refs as the standard's", () => {
    expect(normalizeArgs({ ref: '@e5', text: 'x' })).toEqual({ target: 'e5', text: 'x' });
    expect(normalizeArgs({ fromRef: 'e1', toRef: '[ref=f2e3]' })).toEqual({
      startTarget: 'e1',
      endTarget: 'f2e3',
    });
    expect(normalizeArgs({ usernameRef: 'e1', passwordRef: 'e2' })).toEqual({
      usernameTarget: 'e1',
      passwordTarget: 'e2',
    });
    expect(normalizeArgs({ fields: [{ ref: 'e4', value: 'a' }] })).toEqual({
      fields: [{ target: 'e4', value: 'a' }],
    });
  });

  it('keeps the standard name when both are given', () => {
    expect(normalizeArgs({ ref: 'e1', target: 'e2' })).toEqual({ target: 'e2' });
  });
});

describe('ACTION_CATEGORIES', () => {
  it('mirrors the order @helena/sdk decided (D-C1)', () => {
    expect([...ACTION_CATEGORIES]).toEqual([
      'read',
      'report',
      'write',
      'send',
      'publish',
      'execute',
      'delete',
      'pay',
      'credentials',
    ]);
  });
});
