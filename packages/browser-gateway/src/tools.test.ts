import { describe, expect, it } from 'bun:test';
import { BROWSER_TOOLS, CREDENTIAL_TOOLS, requiresLock, toolByName } from './tools';

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
