import assert from "node:assert/strict";
import { it } from "node:test";
import { createConnectionsService } from "../connections.mjs";

it("reports Hermes without exposing an agent gateway", async () => {
  const service = createConnectionsService({ hermesHome: "/srv/hermes", nextcloudInternalUrl: "http://127.0.0.1:1" }, { fetch: async () => ({ status: 200 }) });
  const snapshot = await service.snapshot();
  assert.equal(snapshot.items.find((item) => item.id === "service:hermes").connected, true);
  await assert.rejects(service.action({ id: "service:hermes", action: "reconnect" }));
});
