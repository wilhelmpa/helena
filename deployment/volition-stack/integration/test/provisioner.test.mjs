import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createProvisioner, ProvisioningConflictError } from "../provisioner.mjs";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
let root;

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-provisioner-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function config() {
  return {
    projectsRoot: path.join(root, "projects"),
    vaultRoot: path.join(root, "vault"),
    projectTrashRoot: path.join(root, "trash/projects"),
    projectTrashRetentionDays: 30,
    verveProjectPath: path.join(root, "verve"),
    registryRoot: path.join(root, "state/projects"),
    ledgerPath: path.join(root, "state/ledger.json"),
    hermesHome: path.join(root, "hermes"),
    hermesAgentsRoot: path.join(root, "hermes/agents"),
    hermesRunnerDescriptorRoot: path.join(root, "hermes/run/agents"),
    hermesRunnerService: "volition-hermes-runner.service",
    systemctlBin: "/usr/bin/systemctl",
    codeUrl: "https://plan.example.com/workspace/code/",
    terminalUrl: "https://plan.example.com/focus/terminal-project/",
    planUrl: "https://plan.example.com/",
  };
}

function envelope(overrides = {}) {
  return {
    eventId,
    eventType: "project.provision",
    project: { id: 7, key: "DEMO", name: "Demo", description: "", teamId: 3, ...overrides },
    requestedResources: ["workspace", "coordinator", "files"],
    createdAt: "2026-09-21T00:00:00.000Z",
  };
}

function fakeCoordinator(calls) {
  return async (_config, project, options) => {
    calls.push({ project, options });
    const id = "hermes-" + project.key.toLowerCase() + "-coordinator";
    return {
      planAgentId: 21,
      planAgentUserId: "agent-user",
      username: id,
      hermesIdentity: id,
      organization: { departmentId: 4, reportsToAgentId: null, projectInstructions: "Project scope" },
    };
  };
}

describe("createProvisioner", () => {
  it("provisions a Hermes coordinator and reloads the common runner exactly once", async () => {
    const coordinatorCalls = [];
    const commandCalls = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator(coordinatorCalls),
      ensureFiles: async (slug) => ({ kind: "files", id: "/Projects/" + slug }),
      execute: async (bin, args) => { commandCalls.push({ bin, args }); return { stdout: "", stderr: "" }; },
    });
    const first = await provisioner.provision(envelope());
    const second = await provisioner.provision(envelope());

    assert.deepEqual(second, first);
    assert.equal(coordinatorCalls.length, 1);
    assert.deepEqual(coordinatorCalls[0].options.workspace, {
      slug: "demo",
      hostPath: path.join(root, "projects/demo"),
      containerPath: "/projects/demo",
      managed: true,
    });
    assert.deepEqual(commandCalls, [{ bin: "/usr/bin/systemctl", args: ["--user", "restart", "volition-hermes-runner.service"] }]);
    assert.deepEqual(first.resources.map((item) => item.kind), ["workspace", "registry", "coordinator", "files"]);
    assert.equal(first.resources[2].id, "hermes-demo-coordinator");

    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.equal(registry.resources.coordinator.id, "hermes-demo-coordinator");
    assert.equal(registry.resources.coordinator.hermesHome, path.join(root, "hermes/profiles/demo"));
    assert.equal("apiKey" in registry.resources.coordinator, false);
    const context = JSON.parse(await fs.readFile(path.join(root, "projects/demo/PROJECT.json"), "utf8"));
    assert.equal(context.coordinatorId, "hermes-demo-coordinator");
  });

  it("provisions the browser before reloading Hermes and exposes no CDP details", async () => {
    const order = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensureProjectBrowser: async (project, slug) => {
        order.push("browser");
        return {
          id: `project-browser:${slug}`,
          name: "project-browser",
          profile: `project:${project.id}:${slug}`,
          cdpUrl: "http://127.0.0.1:19201",
          url: `https://plan.example.com/browser/projects/${slug}/vnc.html?autoconnect=1&resize=remote&path=browser%2Fprojects%2F${slug}%2Fwebsockify`,
        };
      },
      execute: async (_bin, args) => {
        if (args.includes("restart")) order.push("runner-restart");
        return { stdout: "", stderr: "" };
      },
    });
    const request = envelope();
    request.requestedResources = ["workspace", "coordinator", "browser"];

    const result = await provisioner.provision(request);

    assert.deepEqual(order, ["browser", "runner-restart"]);
    assert.deepEqual(result.resources.map((item) => item.kind), [
      "workspace",
      "registry",
      "coordinator",
      "browser",
    ]);
    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.deepEqual(registry.resources.browser, {
      id: "project-browser:demo",
      name: "project-browser",
      profile: "project:7:demo",
      url: "https://plan.example.com/browser/projects/demo/vnc.html?autoconnect=1&resize=remote&path=browser%2Fprojects%2Fdemo%2Fwebsockify",
    });
    assert.doesNotMatch(JSON.stringify(registry.resources.browser), /cdp|port|token|secret|session/i);
  });

  it("keeps ordinary workspace and terminal provisioning independent", async () => {
    const provisioner = createProvisioner(config(), { execute: async () => ({ stdout: "", stderr: "" }) });
    const request = envelope();
    request.requestedResources = ["workspace", "terminal"];
    const result = await provisioner.provision(request);
    assert.deepEqual(result.resources.map((item) => item.kind), ["workspace", "registry", "terminal"]);
  });

  it("creates the canonical vault and quarantines every managed project resource idempotently", async () => {
    const commandCalls = [];
    const browserRoot = path.join(root, "browser/projects/demo");
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensureProjectBrowser: async () => {
        await fs.mkdir(browserRoot, { recursive: true });
        return {
          id: "project-browser:demo",
          name: "project-browser",
          profile: "project:7:demo",
        };
      },
      deprovisionProjectBrowser: async (_project, _slug, quarantineRoot) => {
        const destination = path.join(quarantineRoot, "browser");
        try {
          await fs.rename(browserRoot, destination);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        return destination;
      },
      execute: async (bin, args) => {
        commandCalls.push({ bin, args });
        return { stdout: "", stderr: "" };
      },
    });
    const request = envelope();
    request.requestedResources = ["workspace", "coordinator", "files", "browser", "terminal"];
    await provisioner.provision(request);
    assert.deepEqual(
      await fs.readdir(path.join(root, "vault/Projects/DEMO")),
      ["Assets", "Docs", "Files", "Inbox"],
    );
    for (const directory of ["vault", "vault/Projects", "vault/Projects/DEMO", "vault/Projects/DEMO/Docs"]) {
      const stat = await fs.stat(path.join(root, directory));
      assert.equal(stat.mode & 0o7777, 0o2770, `${directory} must be writable by Plan and Hermes`);
    }

    const deletion = {
      ...request,
      eventId: "223e4567-e89b-42d3-a456-426614174001",
      eventType: "project.deprovision",
      createdAt: "2026-09-22T00:00:00.000Z",
    };
    const first = await provisioner.deprovision(deletion);
    const retried = await provisioner.deprovision(deletion);
    assert.deepEqual(retried, first);
    const quarantine = path.join(root, "trash/projects", deletion.eventId);
    assert.deepEqual(
      (await fs.readdir(quarantine)).sort(),
      ["browser", "hermes-profile", "receipt.json", "registry.json", "vault", "workspace"],
    );
    const receipt = JSON.parse(await fs.readFile(path.join(quarantine, "receipt.json"), "utf8"));
    assert.equal(receipt.project.id, 7);
    assert.equal(receipt.retentionDays, 30);
    assert.ok(Date.parse(receipt.purgeAfter) > Date.now());
    assert.equal(await fs.stat(path.join(root, "vault/Home")).then((stat) => stat.isDirectory()), true);
    assert.equal(await fs.stat(path.join(root, "vault/Templates")).then((stat) => stat.isDirectory()), true);
    assert.ok(commandCalls.some(({ args }) => args.includes("restart")));
  });

  it("rejects reuse of an event id with another request", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensureFiles: async (slug) => ({ kind: "files", id: "/Projects/" + slug }),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    await provisioner.provision(envelope());
    await assert.rejects(provisioner.provision(envelope({ name: "Other" })), ProvisioningConflictError);
  });
});
