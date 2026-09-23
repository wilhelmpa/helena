import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.mjs";

describe("loadConfig", () => {
  it("uses persistent Volition state and Hermes defaults", () => {
    const config = loadConfig({ HOME: "/home/pw" });
    assert.equal(config.registryRoot, "/home/pw/services/volition-workspaces/.state/projects");
    assert.equal(config.hermesHome, "/home/pw/services/volition-stack/data/hermes");
    assert.equal(config.vaultRoot, "/srv/volition/vault");
    assert.equal(config.projectTrashRoot, "/srv/volition/trash/projects");
    assert.equal(config.projectTrashRetentionDays, 30);
    assert.equal(config.projectBrowserSystemctlUser, false);
    assert.equal(config.inboxTriageControlPlane, "mastra");
  });
  it("rejects a non-Mastra inbox control plane", () => {
    assert.throws(() => loadConfig({ HOME: "/home/pw", INBOX_TRIAGE_CONTROL_PLANE: "direct" }), /must be mastra/);
  });
});
