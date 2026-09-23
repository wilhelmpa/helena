import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { launcherRequest, LauncherError } from "../agent-launcher.mjs";
import { createProvisioner } from "../provisioner.mjs";
import {
  createIsolatedProjectBrowserDeprovisioner,
  createIsolatedProjectBrowserProvisioner,
} from "../project-browser.mjs";

// Provisioning with agent isolation: the project's Unix user comes from the root launcher,
// once before provisioning writes into the workspace and once with every folder in place,
// and it goes with the project.

const eventId = "123e4567-e89b-42d3-a456-426614174000";
let root;

beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "volition-isolation-"))); });
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
    planControlToken: "control-token-value-with-at-least-32-bytes",
    agentIsolation: true,
  };
}

function envelope(type = "project.provision") {
  return {
    eventId,
    eventType: type,
    project: { id: 7, key: "DEMO", name: "Demo", description: "", teamId: 3 },
    requestedResources: ["workspace", "coordinator", "files"],
    agents: [12],
    createdAt: "2026-09-21T00:00:00.000Z",
  };
}

function fakeLauncher(calls) {
  return {
    enabled: true,
    async ensureProjectUser(slug, profiles = []) {
      const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects", `${slug}.json`), "utf8"));
      const agentsFile = await fs.stat(path.join(root, "projects", slug, "AGENTS.md")).then(() => true, () => false);
      calls.push({ op: "ensure", slug, profiles, registryProject: registry.project.id, agentsFile });
      return { user: `vp-${slug}` };
    },
    async removeProjectUser(slug) {
      calls.push({ op: "remove", slug });
      return { removed: true };
    },
    async browserState() {
      throw new Error("not requested");
    },
  };
}

const coordinator = async (_config, project) => ({
  planAgentId: 21,
  planAgentUserId: "agent-user",
  username: `hermes-${project.key.toLowerCase()}-coordinator`,
  descriptorChanged: false,
  organization: { projectInstructions: "" },
});

const projectAgent = async (config, project, agentId) => {
  const name = `${project.key.toLowerCase()}_${agentId}`;
  await fs.mkdir(config.hermesRunnerDescriptorRoot, { recursive: true });
  await fs.writeFile(path.join(config.hermesRunnerDescriptorRoot, `${name}.json`), "{}", { mode: 0o600 });
  return {
    planAgentId: agentId,
    username: `agent-${agentId}`,
    name,
    hermesHome: path.join(config.hermesHome, "profiles", name),
    descriptorChanged: false,
  };
};

describe("provisioning with agent isolation", () => {
  it("makes the project user before the workspace is written and again with every folder", async () => {
    const calls = [];
    const provisioner = createProvisioner(config(), {
      launcher: fakeLauncher(calls),
      ensurePlanCoordinator: coordinator,
      ensurePlanProjectAgent: projectAgent,
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    await provisioner.provision(envelope());
    assert.deepEqual(calls, [
      { op: "ensure", slug: "demo", profiles: [], registryProject: 7, agentsFile: false },
      { op: "ensure", slug: "demo", profiles: ["demo", "demo_12"], registryProject: 7, agentsFile: true },
    ]);
    // What provisioning writes for the agents has group bits, for the workspace ACL to narrow.
    const stat = await fs.stat(path.join(root, "projects/demo/AGENTS.md"));
    assert.equal(stat.mode & 0o070, 0o040);
  });

  it("removes the project user with the project", async () => {
    const calls = [];
    const options = {
      launcher: fakeLauncher(calls),
      ensurePlanCoordinator: coordinator,
      ensurePlanProjectAgent: projectAgent,
      execute: async () => ({ stdout: "", stderr: "" }),
    };
    await createProvisioner(config(), options).provision(envelope());
    calls.length = 0;
    await createProvisioner(config(), options).deprovision({
      ...envelope("project.deprovision"),
      eventId: "223e4567-e89b-42d3-a456-426614174000",
    });
    assert.deepEqual(calls, [{ op: "remove", slug: "demo" }]);
  });
});

describe("agent launcher client", () => {
  async function server(answer) {
    const socketPath = path.join(root, "launch.sock");
    const seen = [];
    const listener = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        seen.push(JSON.parse(chunk.toString().split("\n")[0]));
        const body = Buffer.from(JSON.stringify(answer.body));
        const head = Buffer.alloc(5);
        head.writeUInt8(answer.kind, 0);
        head.writeUInt32BE(body.length, 1);
        socket.end(Buffer.concat([head, body]));
      });
    });
    await new Promise((resolve) => listener.listen(socketPath, resolve));
    return { socketPath, seen, close: () => listener.close() };
  }

  it("sends one request line and reads the result", async () => {
    const fake = await server({ kind: 0x15, body: { user: "vp-demo", created: true } });
    try {
      const answer = await launcherRequest(fake.socketPath, { op: "ensure-project-user", slug: "demo", profiles: [] });
      assert.deepEqual(answer, { user: "vp-demo", created: true });
      assert.deepEqual(fake.seen, [{ v: 1, op: "ensure-project-user", slug: "demo", profiles: [] }]);
    } finally {
      fake.close();
    }
  });

  it("turns a refusal into an error with its code", async () => {
    const fake = await server({ kind: 0x14, body: { error: "slug", message: "the project is not provisioned" } });
    try {
      await assert.rejects(
        launcherRequest(fake.socketPath, { op: "ensure-project-user", slug: "x" }),
        (error) => error instanceof LauncherError && error.code === "slug",
      );
    } finally {
      fake.close();
    }
  });
});

describe("project browser with agent isolation", () => {
  const browserConfig = () => ({
    projectBrowserRoot: path.join(root, "browser/projects"),
    projectBrowserPublicUrl: "https://plan.example.com/browser/",
    projectBrowserDisplayBase: 200,
    projectBrowserCdpPortBase: 19200,
    projectBrowserVncPortBase: 15900,
    projectBrowserNoVncPortBase: 16080,
    projectBrowserSystemctlUser: false,
    systemctlBin: "/usr/bin/systemctl",
  });

  it("has the browser user write the state and starts the units as before", async () => {
    const commands = [];
    const asked = [];
    const launcher = {
      browserState: async (...args) => {
        asked.push(args);
        return { state: { schemaVersion: 1, projectId: 7, slug: "demo", slot: 3 } };
      },
    };
    const ensure = createIsolatedProjectBrowserProvisioner(browserConfig(), {
      execute: async (bin, args) => { commands.push([bin, ...args]); return { stdout: "", stderr: "" }; },
      launcher,
      probeCdp: async (port) => port === 19203,
    });
    const browser = await ensure({ id: 7 }, "demo");
    assert.deepEqual(asked, [["ensure", "demo", 7]]);
    assert.deepEqual(commands, [[
      "/usr/bin/systemctl", "start", "volition-project-browser-kasm@demo.service", "volition-project-browser-chromium@demo.service",
    ]]);
    assert.equal(browser.cdpUrl, "http://127.0.0.1:19203");
    // Nothing of the browser state was written by the provisioning service.
    await assert.rejects(fs.stat(path.join(root, "browser/projects/demo")));
  });

  it("refuses a state that names another project", async () => {
    const ensure = createIsolatedProjectBrowserProvisioner(browserConfig(), {
      execute: async () => ({ stdout: "", stderr: "" }),
      launcher: { browserState: async () => ({ state: { projectId: 8, slug: "demo", slot: 3 } }) },
      probeCdp: async () => true,
    });
    await assert.rejects(ensure({ id: 7 }, "demo"), /conflicts/);
  });

  it("stops the units and has the browser user move the state to its trash", async () => {
    const commands = [];
    const asked = [];
    const deprovision = createIsolatedProjectBrowserDeprovisioner(browserConfig(), {
      execute: async (bin, args) => { commands.push(args.join(" ")); return { stdout: "", stderr: "" }; },
      launcher: {
        browserState: async (...args) => { asked.push(args); return { destination: "/trash/x/demo" }; },
      },
    });
    const destination = await deprovision({ id: 7 }, "demo", path.join(root, "trash", eventId));
    assert.equal(destination, "/trash/x/demo");
    assert.deepEqual(asked, [["remove", "demo", 7, eventId]]);
    assert.ok(commands.some((command) => command.startsWith("stop volition-project-browser-chromium@demo")));
  });
});
