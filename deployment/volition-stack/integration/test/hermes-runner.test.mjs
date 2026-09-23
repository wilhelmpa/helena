import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const integration = resolve(import.meta.dirname, "..");

describe("Hermes runner deployment", () => {
  it("builds one dynamic runner catalog with a Home entry and private project descriptors", () => {
    const config = JSON.parse(readFileSync(resolve(integration, "hermes-runner/itsaplan-runner.json"), "utf8"));
    const catalog = readFileSync(resolve(integration, "scripts/volition-hermes-catalog.py"), "utf8");
    const wrapper = readFileSync(resolve(integration, "scripts/volition-hermes-runner"), "utf8");
    const unit = readFileSync(resolve(integration, "../native/systemd/volition-hermes-runner.service"), "utf8");

    assert.equal(config.agent, "hermes");
    assert.equal(config.apiKey, undefined);
    assert.equal(config.cwd, "/srv/volition/workspaces");
    assert.deepEqual(config.args, ["--checkpoints"]);
    assert.equal(config.concurrency, 3);
    assert.ok(catalog.includes("descriptor_entries"));
    assert.ok(catalog.includes("private_file(descriptor_path"));
    assert.ok(catalog.includes("materialize_agent_home"));
    assert.ok(catalog.includes("'hermes-home-master'"));
    assert.ok(catalog.includes("'HERMES_SHARED_AUTH_DIR'"));
    assert.ok(catalog.includes("'BROWSER_CDP_URL'"));
    assert.ok(catalog.includes("require_browser_toolset"));
    assert.ok(wrapper.includes("HERMES_RUNNER_DESCRIPTOR_ROOT"));
    assert.ok(wrapper.includes("HERMES_PROJECT_BROWSER_ROOT"));
    assert.ok(wrapper.includes("catalog_script=/usr/local/libexec/volition-hermes-catalog.py"));
    assert.ok(unit.includes("LoadCredential=itsaplan_api_key:/etc/volition/hermes-plan-key"));
    assert.ok(unit.includes("ExecStart=/usr/local/libexec/volition-hermes-runner"));
  });

  it("exports the native Hermes runtime environment before starting the runner", () => {
    const wrapper = readFileSync(resolve(integration, "scripts/volition-hermes-runner"), "utf8");
    const setup = wrapper.split("\n/var/lib/volition/hermes/venv/bin/python", 1)[0];
    const root = mkdtempSync(join(tmpdir(), "hermes-runner-env-"));
    try {
      const credentials = join(root, "credentials");
      mkdirSync(credentials);
      writeFileSync(join(credentials, "itsaplan_api_key"), "test-only");
      const output = execFileSync(
        "/bin/sh",
        ["-c", `${setup}\nprintf '%s\\n' "$HERMES_RUNNER_DESCRIPTOR_ROOT" "$HERMES_HOME" "$PATH"`],
        { env: { ...process.env, CREDENTIALS_DIRECTORY: credentials }, encoding: "utf8" },
      );
      assert.deepEqual(output.trim().split("\n"), [
        "/var/lib/volition/hermes/run/agents",
        "/var/lib/volition/hermes",
        "/var/lib/volition/hermes/venv/bin:/usr/local/bin:/usr/bin:/bin",
      ]);
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
    assert.ok(config.includes("single_query_mode: approve"));
    assert.ok(config.includes("- plan-approval-guard"));
    assert.equal(catalog.includes("print(item['apiKey']"), false);
    assert.equal(catalog.includes("apiKey={"), false);
  });
});
