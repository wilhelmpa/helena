import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { toolByName } from './tools';

// docs/helena-decisions/browser-tools.md: the gateway speaks Playwright MCP. Every tool the
// standard has keeps its name, its parameters and their enums here; a patchright-core
// upgrade that changes the standard fails this test instead of drifting silently. The
// standard's table is read from the pinned patchright-core itself (its bundled Playwright
// MCP backend, lib/coreBundle → tools.browserTools).

interface StandardTool {
  schema: { name: string; inputSchema: unknown };
}

const require = createRequire(import.meta.url);
const { tools } = require('patchright-core/lib/coreBundle') as {
  tools: { browserTools: StandardTool[] };
};
const { z } = require('patchright-core/lib/utilsBundle') as {
  z: { toJSONSchema(schema: unknown): JsonSchema };
};

interface JsonSchema {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  items?: JsonSchema;
  type?: string;
}

// Parameters of the standard the gateway leaves out on purpose (the decision record says
// why): files on the server (`filename`), selector-free snapshots (`boxes`), image formats
// and scales other than a masked CSS-pixel PNG, the regular expression search (ReDoS).
const LEFT_OUT: Record<string, string[]> = {
  browser_snapshot: ['filename', 'boxes'],
  browser_take_screenshot: ['type', 'filename', 'scale'],
  browser_console_messages: ['all', 'filename'],
  browser_network_requests: ['filename'],
  browser_find: ['regex'],
};

const ADOPTED = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_reload',
  'browser_snapshot',
  'browser_find',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_hover',
  'browser_drag',
  'browser_press_key',
  'browser_wait_for',
  'browser_take_screenshot',
  'browser_tabs',
  'browser_handle_dialog',
  'browser_file_upload',
  'browser_console_messages',
  'browser_network_requests',
];

function standard(name: string): JsonSchema {
  const tool = tools.browserTools.find((candidate) => candidate.schema.name === name);
  if (!tool) throw new Error(`Playwright MCP has no ${name} any more`);
  return z.toJSONSchema(tool.schema.inputSchema);
}

function checkSchema(ours: JsonSchema, theirs: JsonSchema, where: string, leftOut: string[]) {
  const ourProperties = ours.properties ?? {};
  for (const [key, property] of Object.entries(theirs.properties ?? {})) {
    if (leftOut.includes(key)) continue;
    const mine = ourProperties[key];
    expect(mine, `${where}.${key}`).toBeDefined();
    if (property.enum) {
      for (const value of mine!.enum ?? [])
        expect(property.enum, `${where}.${key}`).toContain(value);
    }
    if (property.items?.properties) {
      checkSchema(mine!.items ?? {}, property.items, `${where}.${key}[]`, []);
    }
  }
  for (const key of theirs.required ?? []) {
    if (leftOut.includes(key)) continue;
    // The standard's defaults (a `default` makes zod list it as required) are optional here.
    const property = theirs.properties?.[key] as (JsonSchema & { default?: unknown }) | undefined;
    if (property && 'default' in property) continue;
    expect(ours.required ?? [], `${where} requires ${key}`).toContain(key);
  }
}

describe('Playwright MCP parity', () => {
  for (const name of ADOPTED) {
    it(`${name} has the standard's parameters`, () => {
      const ours = toolByName(name);
      expect(ours, name).toBeDefined();
      checkSchema(ours!.inputSchema as JsonSchema, standard(name), name, LEFT_OUT[name] ?? []);
    });
  }
});
