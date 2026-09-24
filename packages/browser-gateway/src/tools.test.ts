import { describe, expect, it } from 'bun:test';
import { BROWSER_TOOLS, CREDENTIAL_TOOLS, categoryOf, requiresLock, toolByName } from './tools';
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
    for (const forbidden of ['evaluate', 'eval', 'script', 'cookie', 'cdp']) {
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
      'browser_screenshot',
      'browser_console',
    ]) {
      expect(toolByName(name)?.category).toBe('read');
    }
    for (const name of ['browser_navigate', 'browser_click', 'browser_type']) {
      expect(toolByName(name)?.category).toBe('write');
    }
    expect(toolByName('browser_upload')?.category).toBe('send');
  });

  it('a click, typed Enter or pressed Enter that submits a form is a send', () => {
    expect(categoryOf(toolByName('browser_click')!, true)).toBe('send');
    expect(categoryOf(toolByName('browser_click')!, false)).toBe('write');
    expect(categoryOf(toolByName('browser_press')!, true)).toBe('send');
    expect(categoryOf(toolByName('browser_navigate')!, true)).toBe('write');
  });

  it('are shown to MCP clients as annotations and _meta', () => {
    const listed = mcpToolOf(toolByName('browser_snapshot')!);
    expect(listed.annotations.readOnlyHint).toBe(true);
    expect(listed._meta).toEqual({ 'helena/actionCategory': 'read' });
    expect(mcpToolOf(toolByName('browser_click')!).annotations.readOnlyHint).toBe(false);
  });
});
