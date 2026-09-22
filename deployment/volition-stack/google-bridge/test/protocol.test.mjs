import assert from "node:assert/strict";
import test from "node:test";
import { mcpResult, READ_ONLY_TOOL_ANNOTATIONS } from "../protocol.mjs";

test("MCP tools declare their read-only external-data behavior", () => {
  assert.deepEqual(READ_ONLY_TOOL_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.equal(Object.isFrozen(READ_ONLY_TOOL_ANNOTATIONS), true);
});

test("MCP structured content wraps list results in an object", () => {
  const result = mcpResult([{ id: "thread_1" }]);
  assert.deepEqual(result.structuredContent, { items: [{ id: "thread_1" }] });
  assert.equal(result.content[0].text, '[{"id":"thread_1"}]');
});

test("MCP structured content preserves object results", () => {
  const result = mcpResult({ events: [] });
  assert.deepEqual(result.structuredContent, { events: [] });
});
