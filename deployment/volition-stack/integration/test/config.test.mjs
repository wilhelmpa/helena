import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config.mjs";

describe("loadConfig", () => {
  it("uses persistent Volition state and Hermes defaults", () => {
    const config = loadConfig({});
    assert.equal(config.projectsRoot, "/srv/volition/workspaces/projects");
    assert.equal(config.registryRoot, "/var/lib/volition/provisioning/projects");
    assert.equal(config.ledgerPath, "/var/lib/volition/provisioning/provisioning-ledger.json");
    assert.equal(config.hermesHome, "/var/lib/volition/hermes");
    assert.equal(config.hermesRunnerDescriptorRoot, "/var/lib/volition/hermes/run/agents");
    assert.equal(config.vaultRoot, "/srv/volition/vault");
    assert.equal(config.projectTrashRoot, "/srv/volition/trash/projects");
    assert.equal(config.projectTrashRetentionDays, 30);
    assert.equal(config.projectBrowserSystemctlUser, false);
    assert.equal(config.inboxTriageControlPlane, "mastra");
  });
  it("rejects a non-Mastra inbox control plane", () => {
    assert.throws(() => loadConfig({ INBOX_TRIAGE_CONTROL_PLANE: "direct" }), /must be mastra/);
  });
});
