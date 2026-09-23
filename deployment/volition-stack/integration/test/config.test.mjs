import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig, loadServerSecrets } from "../config.mjs";

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
    assert.deepEqual(config.inboxAccounts, []);
  });
  it("rejects a non-Mastra inbox control plane", () => {
    assert.throws(() => loadConfig({ INBOX_TRIAGE_CONTROL_PLANE: "direct" }), /must be mastra/);
  });
  it("reads the triage accounts as trimmed, lowercased mail addresses", () => {
    const config = loadConfig({ INBOX_TRIAGE_ACCOUNTS: " Owner@Example.com, ,archive@example.com," });
    assert.deepEqual(config.inboxAccounts, ["owner@example.com", "archive@example.com"]);
  });
});

describe("loadServerSecrets", () => {
  it("loads the triage tokens only when triage accounts are set", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-config-"));
    try {
      const inboxTokenFile = path.join(root, "inbox-token");
      const mastraTokenFile = path.join(root, "mastra-token");
      await fs.writeFile(inboxTokenFile, "i".repeat(32), { mode: 0o600 });
      await fs.writeFile(mastraTokenFile, "m".repeat(32), { mode: 0o600 });
      const env = {
        PROVISIONING_TOKEN: "p".repeat(32),
        INBOX_INTEGRATION_TOKEN_FILE: inboxTokenFile,
        MASTRA_INBOX_TOKEN_FILE: mastraTokenFile,
      };
      const off = await loadServerSecrets(loadConfig(env));
      assert.equal(off.inboxIntegrationToken, undefined);
      assert.equal(off.mastraInboxToken, undefined);
      const on = await loadServerSecrets(
        loadConfig({ ...env, INBOX_TRIAGE_ACCOUNTS: "owner@example.com" }),
      );
      assert.equal(on.inboxIntegrationToken, "i".repeat(32));
      assert.equal(on.mastraInboxToken, "m".repeat(32));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
