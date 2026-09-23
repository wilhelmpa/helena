import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnvelope } from "../validation.mjs";

const id = "123e4567-e89b-42d3-a456-426614174000";
const headers = { idempotencyKey: id, eventType: "project.provision" };

function envelope(fields = {}) {
  return {
    eventId: id,
    eventType: "project.provision",
    project: { id: 7, key: "DEMO", name: "Demo", teamId: 3 },
    requestedResources: ["workspace", "coordinator"],
    createdAt: "2026-09-21T00:00:00.000Z",
    ...fields,
  };
}

test("agent ids are passed on and left out when there are none", () => {
  assert.deepEqual(validateEnvelope(envelope({ agents: [31, 32] }), headers).agents, [31, 32]);
  assert.equal("agents" in validateEnvelope(envelope({ agents: [] }), headers), false);
  assert.equal("agents" in validateEnvelope(envelope(), headers), false);
});

test("agent ids must be distinct positive integers and are refused for a deletion", () => {
  for (const agents of [[0], [1.5], ["31"], [31, 31], {}, Array.from({ length: 201 }, (_, i) => i + 1)]) {
    assert.throws(() => validateEnvelope(envelope({ agents }), headers), /agent/);
  }
  assert.throws(
    () =>
      validateEnvelope(envelope({ eventType: "project.deprovision", agents: [31] }), {
        ...headers,
        eventType: "project.deprovision",
      }),
    /deprovisioning/,
  );
});
