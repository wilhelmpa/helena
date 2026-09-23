import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const integration = resolve(import.meta.dirname, "..");

describe("Hermes runner deployment", () => {
  it("builds one dynamic runner catalog with a Home entry and private project descriptors", () => {
    const config = JSON.parse(readFileSync(resolve(integration, "hermes-runner/itsaplan-runner.json"), "utf8"));
    const catalog = readFileSync(resolve(integration, "scripts/volition-hermes-catalog.py"), "utf8");
    const wrapper = readFileSync(resolve(integration, "scripts/volition-hermes-runner"), "utf8");
    const unit = readFileSync(resolve(integration, "systemd/volition-hermes-runner.service"), "utf8");

    assert.equal(config.agent, "hermes");
    assert.equal(config.apiKey, undefined);
    assert.deepEqual(config.models, []);
    assert.ok(catalog.includes("descriptor_entries"));
    assert.ok(catalog.includes("private_file(descriptor_path"));
    assert.ok(catalog.includes("materialize_agent_home"));
    assert.ok(catalog.includes("'hermes-home-master'"));
    assert.ok(catalog.includes("'HERMES_SHARED_AUTH_DIR'"));
    assert.ok(catalog.includes("'BROWSER_CDP_URL'"));
    assert.ok(catalog.includes("require_browser_toolset"));
    assert.ok(wrapper.includes("HERMES_RUNNER_DESCRIPTOR_ROOT"));
    assert.ok(wrapper.includes("HERMES_PROJECT_BROWSER_ROOT"));
    assert.ok(wrapper.includes('PATH="$HERMES_HOME/node:'));
    assert.ok(unit.includes("ReadOnlyPaths=/home/pw/services/volition-stack/data/hermes/config.yaml"));
    assert.ok(unit.includes("/var/lib/volition/project-browser/projects"));
  });

  it("resolves the pinned browser executable through the actual runner environment", () => {
    const wrapper = readFileSync(resolve(integration, "scripts/volition-hermes-runner"), "utf8");
    const setup = wrapper.split("/home/pw/services/hermes-agent/venv/bin/python", 1)[0];
    const root = mkdtempSync(join(tmpdir(), "hermes-runner-path-"));
    try {
      const credentials = join(root, "credentials");
      const home = join(root, "home");
      mkdirSync(credentials);
      mkdirSync(join(home, "node"), { recursive: true });
      writeFileSync(join(credentials, "itsaplan_api_key"), "test-only");
      const browser = join(home, "node", "agent-browser");
      writeFileSync(browser, "#!/bin/sh\nexit 0\n");
      chmodSync(browser, 0o700);
      const resolved = execFileSync("/bin/sh", ["-c", `${setup}\ncommand -v agent-browser`], {
        env: { ...process.env, CREDENTIALS_DIRECTORY: credentials, HERMES_HOME: home },
        encoding: "utf8",
      }).trim();
      assert.equal(resolved, browser);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps provider credentials out of the template and runner logs", () => {
    const config = readFileSync(resolve(integration, "hermes-runner/hermes-config.fragment.yaml"), "utf8");
    const catalog = readFileSync(resolve(integration, "scripts/volition-hermes-catalog.py"), "utf8");

    assert.ok(config.includes("Bearer " + "$" + "{ITSAPLAN_API_KEY}"));
    assert.ok(config.includes("tirith_enabled: true"));
    assert.ok(config.includes("tirith_fail_open: false"));
    assert.equal(catalog.includes("print(item['apiKey']"), false);
    assert.equal(catalog.includes("apiKey={"), false);
  });
});
