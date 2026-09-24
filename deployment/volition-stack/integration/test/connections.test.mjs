import assert from "node:assert/strict";
import { it } from "node:test";
import { createConnectionsService } from "../connections.mjs";

it("reports Hermes without exposing an agent gateway", async () => {
  const service = createConnectionsService({ hermesHome: "/srv/hermes" });
  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.items.map((item) => item.id), ["service:hermes"]);
  assert.equal(snapshot.items[0].connected, true);
  await assert.rejects(service.action({ id: "service:hermes", action: "reconnect" }));
});
