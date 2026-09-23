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
    planControlToken: "control-token-value-with-at-least-32-bytes",
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
      descriptorChanged: calls.length === 1,
      organization: { departmentId: 4, reportsToAgentId: null, projectInstructions: "Project scope" },
    };
  };
}

// Writes the descriptor file the way the real bootstrap does, so the provisioner finds
// it again when the agent leaves the project.
function fakeProjectAgent(calls, { changed = () => true, fail = () => false } = {}) {
  return async (config, project, agentId, options) => {
    calls.push({ project, agentId, options });
    if (fail(agentId)) throw new Error("Bootstrapping failed with HTTP 404");
    const name = `${project.key.toLowerCase()}_${agentId}`;
    await fs.mkdir(config.hermesRunnerDescriptorRoot, { recursive: true });
    await fs.writeFile(path.join(config.hermesRunnerDescriptorRoot, `${name}.json`), "{}", { mode: 0o600 });
    return {
      planAgentId: agentId,
      username: `agent-${agentId}`,
      name,
      hermesHome: path.join(config.hermesHome, "profiles", name),
      descriptorChanged: changed(agentId),
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

  it("restarts the runner only when a provisioning run changed the runner descriptor", async () => {
    const coordinatorCalls = [];
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator(coordinatorCalls),
      ensureFiles: async (slug) => ({ kind: "files", id: "/Projects/" + slug }),
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    await provisioner.provision(envelope());
    await provisioner.provision({ ...envelope(), eventId: "323e4567-e89b-42d3-a456-426614174002" });

    assert.equal(coordinatorCalls.length, 2);
    assert.equal(restarts.length, 1);
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

  it("deletes the runner descriptor on deprovision", async () => {
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    const request = envelope();
    request.requestedResources = ["workspace"];
    await provisioner.provision(request);
    const descriptor = path.join(root, "hermes/run/agents/demo.json");
    await fs.mkdir(path.dirname(descriptor), { recursive: true });
    await fs.writeFile(descriptor, "{}", { mode: 0o600 });

    const deletion = {
      ...request,
      eventId: "423e4567-e89b-42d3-a456-426614174003",
      eventType: "project.deprovision",
    };
    await provisioner.deprovision(deletion);

    await assert.rejects(fs.lstat(descriptor), { code: "ENOENT" });
    const quarantine = path.join(root, "trash/projects", deletion.eventId);
    assert.deepEqual((await fs.readdir(quarantine)).sort(), ["receipt.json", "registry.json", "workspace"]);
    assert.equal(restarts.length, 1);
  });

  it("moves the folders of a deleted board to the trash and keeps the others", async () => {
    const provisioner = createProvisioner(config(), { execute: async () => ({ stdout: "", stderr: "" }) });
    const board = (id) => ({ resource: `board:${id}`, id, name: `Board ${id}`, slug: `board-${id}`, folder: null });
    const request = envelope();
    request.requestedResources = ["workspace", "files", "board:1", "board:2"];
    request.boards = [board(1), board(2)];
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "vault/Projects/DEMO/Files/Boards/board-2/report.md"), "done");

    const later = {
      ...request,
      eventId: "523e4567-e89b-42d3-a456-426614174004",
      requestedResources: ["workspace", "files", "board:1"],
      boards: [board(1)],
    };
    await provisioner.provision(later);
    await provisioner.provision({ ...later, eventId: "623e4567-e89b-42d3-a456-426614174005" });

    const trash = path.join(root, "trash/projects", later.eventId);
    assert.deepEqual((await fs.readdir(trash)).sort(), ["board-2-files", "board-2-workspace", "receipt.json"]);
    assert.equal(await fs.readFile(path.join(trash, "board-2-files/report.md"), "utf8"), "done");
    assert.deepEqual(await fs.readdir(path.join(root, "projects/demo/boards")), ["board-1"]);
    assert.deepEqual(await fs.readdir(path.join(root, "vault/Projects/DEMO/Files/Boards")), ["board-1"]);
    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.deepEqual(registry.boards.map((item) => item.id), [1]);
    await assert.rejects(fs.lstat(path.join(root, "trash/projects/623e4567-e89b-42d3-a456-426614174005")));
  });

  it("keeps a folder per area in the workspace and the vault and moves it with the area", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "Backend", folder: "backend" },
        { id: 5, name: "Design", folder: "design" },
      ],
    };
    await provisioner.provision(request);

    for (const base of ["projects/demo", "vault/Projects/DEMO"]) {
      for (const folder of ["backend", "design"]) {
        const stat = await fs.stat(path.join(root, base, folder));
        assert.equal(stat.isDirectory(), true, `${base}/${folder}`);
      }
    }
    assert.equal((await fs.stat(path.join(root, "vault/Projects/DEMO/backend"))).mode & 0o7777, 0o2770);
    const instructions = await fs.readFile(path.join(root, "projects/demo/backend/AGENTS.md"), "utf8");
    assert.match(instructions, /^# Area: Backend\n/);
    assert.match(instructions, /project "Demo" \(DEMO\)/);
    await assert.rejects(fs.lstat(path.join(root, "vault/Projects/DEMO/backend/AGENTS.md")), { code: "ENOENT" });
    await fs.writeFile(path.join(root, "projects/demo/backend/AGENTS.md"), "# Edited");
    await fs.writeFile(path.join(root, "vault/Projects/DEMO/backend/notes.md"), "kept");

    const renamed = {
      ...request,
      eventId: "d23e4567-e89b-42d3-a456-42661417400c",
      areas: [
        { id: 4, name: "Server", folder: "server" },
        { id: 5, name: "Design", folder: "design" },
      ],
    };
    await provisioner.provision(renamed);

    assert.deepEqual((await fs.readdir(path.join(root, "projects/demo"))).filter((name) => ["backend", "design", "server"].includes(name)).sort(), ["design", "server"]);
    assert.equal(await fs.readFile(path.join(root, "projects/demo/server/AGENTS.md"), "utf8"), "# Edited");
    assert.equal(await fs.readFile(path.join(root, "vault/Projects/DEMO/server/notes.md"), "utf8"), "kept");
    await assert.rejects(fs.lstat(path.join(root, "vault/Projects/DEMO/backend")), { code: "ENOENT" });
    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.deepEqual(registry.areas, renamed.areas.map((area) => ({ ...area, adopted: [] })));
  });

  it("keeps an area folder in place when its new folder exists already", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = { ...envelope(), areas: [{ id: 4, name: "Backend", folder: "backend" }] };
    await provisioner.provision(request);
    await fs.mkdir(path.join(root, "projects/demo/server"));
    await fs.writeFile(path.join(root, "projects/demo/server/own.txt"), "someone else's");

    const result = await provisioner.provision({
      ...request,
      eventId: "e23e4567-e89b-42d3-a456-42661417400d",
      areas: [{ id: 4, name: "Server", folder: "server" }],
    });

    assert.deepEqual(result.warnings, [
      "The folder backend of the area Server was not moved: server exists already.",
    ]);
    assert.equal(await fs.readFile(path.join(root, "projects/demo/server/own.txt"), "utf8"), "someone else's");
    await assert.rejects(fs.lstat(path.join(root, "projects/demo/server/AGENTS.md")), { code: "ENOENT" });
    for (const folder of ["projects/demo/backend", "vault/Projects/DEMO/backend", "vault/Projects/DEMO/server"]) {
      assert.equal(await fs.stat(path.join(root, folder)).then((stat) => stat.isDirectory()), true, folder);
    }
    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.deepEqual(registry.areas, [{ id: 4, name: "Server", folder: "server", adopted: ["workspace"] }]);
  });

  it("moves an area folder whose new name was the old folder of another area", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "A", folder: "a" },
        { id: 5, name: "B", folder: "b" },
      ],
    };
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "projects/demo/a/from-a.txt"), "a");
    await fs.writeFile(path.join(root, "projects/demo/b/from-b.txt"), "b");

    const result = await provisioner.provision({
      ...request,
      eventId: "f23e4567-e89b-42d3-a456-42661417400e",
      areas: [
        { id: 4, name: "A", folder: "b" },
        { id: 5, name: "B", folder: "c" },
      ],
    });

    assert.equal(result.warnings, undefined);
    assert.equal(await fs.readFile(path.join(root, "projects/demo/b/from-a.txt"), "utf8"), "a");
    assert.equal(await fs.readFile(path.join(root, "projects/demo/c/from-b.txt"), "utf8"), "b");
    await assert.rejects(fs.lstat(path.join(root, "projects/demo/a")), { code: "ENOENT" });
  });

  it("exchanges the folders of two areas that swapped them", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "A", folder: "a" },
        { id: 5, name: "B", folder: "b" },
      ],
    };
    await provisioner.provision(request);
    for (const base of ["projects/demo", "vault/Projects/DEMO"]) {
      await fs.writeFile(path.join(root, base, "a/from-a.txt"), "a");
      await fs.writeFile(path.join(root, base, "b/from-b.txt"), "b");
    }

    const result = await provisioner.provision({
      ...request,
      eventId: "d33e4567-e89b-42d3-a456-426614174012",
      areas: [
        { id: 4, name: "A", folder: "b" },
        { id: 5, name: "B", folder: "a" },
      ],
    });

    assert.equal(result.warnings, undefined);
    for (const base of ["projects/demo", "vault/Projects/DEMO"]) {
      assert.equal(await fs.readFile(path.join(root, base, "b/from-a.txt"), "utf8"), "a");
      assert.equal(await fs.readFile(path.join(root, base, "a/from-b.txt"), "utf8"), "b");
      assert.deepEqual((await fs.readdir(path.join(root, base))).filter((name) => name.startsWith(".area-")), []);
    }
  });

  it("uses a folder that existed before its area and never moves or trashes it", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    await fs.mkdir(path.join(root, "projects/demo/apps"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/demo/apps/main.ts"), "source");
    const request = { ...envelope(), areas: [{ id: 4, name: "Apps", folder: "apps" }] };

    const first = await provisioner.provision(request);

    assert.deepEqual(first.warnings, [
      "The workspace folder apps existed already. The area Apps uses it and never moves or trashes it.",
    ]);
    assert.deepEqual(await fs.readdir(path.join(root, "projects/demo/apps")), ["main.ts"]);
    assert.equal(await fs.stat(path.join(root, "vault/Projects/DEMO/apps/AGENTS.md")).catch(() => null), null);
    const again = await provisioner.provision({ ...request, eventId: "e33e4567-e89b-42d3-a456-426614174013" });
    assert.equal(again.warnings, undefined);

    await provisioner.provision({
      ...request,
      eventId: "f33e4567-e89b-42d3-a456-426614174014",
      areas: [{ id: 4, name: "Frontend", folder: "frontend" }],
    });
    assert.deepEqual(await fs.readdir(path.join(root, "projects/demo/apps")), ["main.ts"]);
    assert.match(await fs.readFile(path.join(root, "projects/demo/frontend/AGENTS.md"), "utf8"), /^# Area: Frontend/);
    assert.equal(await fs.stat(path.join(root, "vault/Projects/DEMO/frontend")).then((stat) => stat.isDirectory()), true);
    await assert.rejects(fs.lstat(path.join(root, "vault/Projects/DEMO/apps")), { code: "ENOENT" });

    const deletion = { ...request, eventId: "a43e4567-e89b-42d3-a456-426614174015", areas: [] };
    await provisioner.provision(deletion);
    assert.deepEqual(await fs.readdir(path.join(root, "projects/demo/apps")), ["main.ts"]);
    const trash = path.join(root, "trash/projects", deletion.eventId);
    assert.deepEqual((await fs.readdir(trash)).sort(), ["area-4-files", "area-4-workspace", "receipt.json"]);
  });

  it("records each trashed and moved folder, so a failed run is not repeated", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "Old", folder: "shared" },
        { id: 5, name: "New", folder: "new" },
      ],
    };
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "projects/demo/new/work.md"), "kept");
    const changed = { ...request, areas: [{ id: 5, name: "New", folder: "shared" }] };

    await assert.rejects(
      provisioner.provision({
        ...changed,
        eventId: "b43e4567-e89b-42d3-a456-426614174016",
        requestedResources: [...request.requestedResources, "board:1"],
        boards: [{ resource: "board:1", id: 2, name: "Broken", slug: "broken", folder: null }],
      }),
      /Invalid board resource/,
    );
    await provisioner.provision({ ...changed, eventId: "c43e4567-e89b-42d3-a456-426614174017" });

    assert.equal(await fs.readFile(path.join(root, "projects/demo/shared/work.md"), "utf8"), "kept");
    await assert.rejects(fs.lstat(path.join(root, "trash/projects/c43e4567-e89b-42d3-a456-426614174017")));
  });

  it("moves the folders of a deleted area to the trash and leaves unknown folders alone", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "Backend", folder: "backend" },
        { id: 5, name: "Design", folder: "design" },
      ],
    };
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "vault/Projects/DEMO/design/brief.md"), "kept in the trash");
    await fs.mkdir(path.join(root, "projects/demo/scratch"));

    const later = {
      ...request,
      eventId: "a33e4567-e89b-42d3-a456-42661417400f",
      areas: [{ id: 4, name: "Backend", folder: "backend" }],
    };
    await provisioner.provision(later);
    await provisioner.provision({ ...later, eventId: "b33e4567-e89b-42d3-a456-426614174010" });

    const trash = path.join(root, "trash/projects", later.eventId);
    assert.deepEqual((await fs.readdir(trash)).sort(), ["area-5-files", "area-5-workspace", "receipt.json"]);
    assert.equal(await fs.readFile(path.join(trash, "area-5-files/brief.md"), "utf8"), "kept in the trash");
    const receipt = JSON.parse(await fs.readFile(path.join(trash, "receipt.json"), "utf8"));
    assert.deepEqual(receipt.quarantined.map((item) => item.label).sort(), ["area-5-files", "area-5-workspace"]);
    await assert.rejects(fs.lstat(path.join(root, "projects/demo/design")), { code: "ENOENT" });
    assert.equal(await fs.stat(path.join(root, "projects/demo/scratch")).then((stat) => stat.isDirectory()), true);
    await assert.rejects(fs.lstat(path.join(root, "trash/projects/b33e4567-e89b-42d3-a456-426614174010")));
  });

  it("reports only the areas whose folders exist, so the worker recreates a missing one", async () => {
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    const request = {
      ...envelope(),
      areas: [
        { id: 4, name: "Backend", folder: "backend" },
        { id: 5, name: "Design", folder: "design" },
      ],
    };
    await provisioner.provision(request);
    await fs.rm(path.join(root, "vault/Projects/DEMO/design"), { recursive: true });

    assert.deepEqual((await provisioner.state()).projects[0].areas, [{ id: 4, folder: "backend" }]);

    await provisioner.provision({ ...request, eventId: "c33e4567-e89b-42d3-a456-426614174011" });

    assert.deepEqual((await provisioner.state()).projects[0].areas, [
      { id: 4, folder: "backend" },
      { id: 5, folder: "design" },
    ]);
  });

  it("reports each registered project with its boards and browser state", async () => {
    const checked = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensureProjectBrowser: async (_project, slug) => ({
        id: `project-browser:${slug}`,
        name: "project-browser",
        profile: `project:7:${slug}`,
      }),
      projectBrowserActive: async (slug) => {
        checked.push(slug);
        return false;
      },
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    assert.deepEqual(await provisioner.state(), { projects: [] });

    const request = envelope();
    request.requestedResources = ["workspace", "browser", "board:4"];
    request.boards = [{ resource: "board:4", id: 4, name: "Board", slug: "board", folder: null }];
    await provisioner.provision(request);
    await provisioner.provision({
      ...envelope({ id: 8, key: "PLAIN" }),
      eventId: "723e4567-e89b-42d3-a456-426614174006",
      requestedResources: ["workspace"],
    });

    const state = await provisioner.state();
    assert.deepEqual(
      state.projects.map(({ project, boards, browserActive, requestedResources }) => ({
        id: project.id,
        boards,
        browserActive,
        requestedResources,
      })),
      [
        { id: 7, boards: [4], browserActive: false, requestedResources: request.requestedResources },
        { id: 8, boards: [], browserActive: null, requestedResources: ["workspace"] },
      ],
    );
    assert.deepEqual(checked, ["demo"]);
  });

  it("drops ledger entries older than 30 days", async () => {
    const provisioner = createProvisioner(config(), { execute: async () => ({ stdout: "", stderr: "" }) });
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await fs.mkdir(path.join(root, "state"), { recursive: true });
    await fs.writeFile(
      path.join(root, "state/ledger.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          "823e4567-e89b-42d3-a456-426614174007": { status: "succeeded", updatedAt: old },
          "923e4567-e89b-42d3-a456-426614174008": { status: "failed", updatedAt: new Date().toISOString() },
        },
      }),
    );
    const request = envelope();
    request.requestedResources = ["workspace"];
    await provisioner.provision(request);

    const ledger = JSON.parse(await fs.readFile(path.join(root, "state/ledger.json"), "utf8"));
    assert.deepEqual(Object.keys(ledger.entries).sort(), [eventId, "923e4567-e89b-42d3-a456-426614174008"]);
  });

  it("moves the resources of a deleted project into the trash across mount points", async () => {
    const trash = path.join(root, "trash/projects");
    // Like the provisioning unit, where every writable path is a mount of its own.
    const rename = async (source, destination) => {
      if (!source.startsWith(trash)) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      return fs.rename(source, destination);
    };
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      execute: async () => ({ stdout: "", stderr: "" }),
      rename,
    });
    const request = envelope();
    request.requestedResources = ["workspace", "coordinator", "files"];
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "vault/Projects/DEMO/Docs/plan.md"), "kept in the trash");

    const deletion = {
      ...request,
      eventId: "a23e4567-e89b-42d3-a456-426614174009",
      eventType: "project.deprovision",
    };
    await provisioner.deprovision(deletion);

    const quarantine = path.join(trash, deletion.eventId);
    assert.deepEqual(
      (await fs.readdir(quarantine)).sort(),
      ["hermes-profile", "receipt.json", "registry.json", "vault", "workspace"],
    );
    assert.equal(await fs.readFile(path.join(quarantine, "vault/Docs/plan.md"), "utf8"), "kept in the trash");
    assert.equal(await fs.stat(path.join(quarantine, "workspace/.git")).then((stat) => stat.isDirectory()), true);
    await assert.rejects(fs.lstat(path.join(root, "projects/demo")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(root, "vault/Projects/DEMO")), { code: "ENOENT" });
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

  it("gives each agent of the project a profile and a runner descriptor of its own", async () => {
    const agentCalls = [];
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensurePlanProjectAgent: fakeProjectAgent(agentCalls),
      ensureProjectBrowser: async (_project, slug) => ({
        id: `project-browser:${slug}`,
        name: "project-browser",
        profile: `project:7:${slug}`,
        cdpUrl: "http://127.0.0.1:19201",
      }),
      projectBrowserActive: async () => true,
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    const request = { ...envelope(), requestedResources: ["workspace", "coordinator", "browser"], agents: [31, 32] };

    await provisioner.provision(request);

    assert.deepEqual(agentCalls.map(({ agentId }) => agentId), [31, 32]);
    assert.equal(agentCalls[0].options.workspace.hostPath, path.join(root, "projects/demo"));
    assert.equal(agentCalls[0].options.browser.cdpUrl, "http://127.0.0.1:19201");
    for (const name of ["demo_31", "demo_32"]) {
      const stat = await fs.stat(path.join(root, "hermes/profiles", name));
      assert.equal(stat.mode & 0o777, 0o700);
    }
    assert.equal(restarts.length, 1);
    const registry = JSON.parse(await fs.readFile(path.join(root, "state/projects/demo.json"), "utf8"));
    assert.deepEqual(registry.agents, [
      { id: 31, username: "agent-31", profile: "demo_31" },
      { id: 32, username: "agent-32", profile: "demo_32" },
    ]);
    const [state] = (await provisioner.state()).projects;
    assert.deepEqual(state.agents, [31, 32]);
  });

  it("removes the runtime of an agent that left the project", async () => {
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensurePlanProjectAgent: fakeProjectAgent([], { changed: () => false }),
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    const request = { ...envelope(), agents: [31, 32] };
    await provisioner.provision(request);
    await fs.writeFile(path.join(root, "hermes/profiles/demo_32/MEMORY.md"), "kept in the trash");
    // Another project's agent with a similar name stays.
    await fs.mkdir(path.join(root, "hermes/profiles/demox_32"), { recursive: true });

    const restartsBefore = restarts.length;
    const later = { ...request, eventId: "b23e4567-e89b-42d3-a456-42661417400a", agents: [31] };
    await provisioner.provision(later);

    await assert.rejects(fs.lstat(path.join(root, "hermes/run/agents/demo_32.json")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(root, "hermes/profiles/demo_32")), { code: "ENOENT" });
    const trash = path.join(root, "trash/projects", later.eventId);
    assert.deepEqual((await fs.readdir(trash)).sort(), ["hermes-profile-demo_32", "receipt.json"]);
    assert.equal(await fs.readFile(path.join(trash, "hermes-profile-demo_32/MEMORY.md"), "utf8"), "kept in the trash");
    assert.equal(await fs.stat(path.join(root, "hermes/profiles/demo_31")).then((stat) => stat.isDirectory()), true);
    assert.equal(await fs.stat(path.join(root, "hermes/profiles/demox_32")).then((stat) => stat.isDirectory()), true);
    assert.equal(restarts.length, restartsBefore + 1);
    const [state] = (await provisioner.state()).projects;
    assert.deepEqual(state.agents, [31]);
  });

  it("reports rather than fails the agents it cannot key without the control token", async () => {
    const agentCalls = [];
    const provisioner = createProvisioner({ ...config(), planControlToken: "" }, {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensurePlanProjectAgent: fakeProjectAgent(agentCalls),
      execute: async () => ({ stdout: "", stderr: "" }),
    });

    const result = await provisioner.provision({ ...envelope(), agents: [31] });

    assert.deepEqual(agentCalls, []);
    assert.deepEqual(result.warnings, ["Project agents get no Hermes runtime without the Plan control token."]);
  });

  it("reloads the runner for the descriptors a failed run already wrote", async () => {
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensurePlanProjectAgent: fakeProjectAgent([], { fail: (agentId) => agentId === 32 }),
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });

    await assert.rejects(provisioner.provision({ ...envelope(), agents: [31, 32] }), /HTTP 404/);
    assert.equal(restarts.length, 1);
  });

  it("removes every agent runtime of a deleted project", async () => {
    const restarts = [];
    const provisioner = createProvisioner(config(), {
      ensurePlanCoordinator: fakeCoordinator([]),
      ensurePlanProjectAgent: fakeProjectAgent([]),
      execute: async (_bin, args) => {
        if (args.includes("restart")) restarts.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    const request = { ...envelope(), agents: [31] };
    await provisioner.provision(request);

    const deletion = {
      ...envelope(),
      eventId: "c23e4567-e89b-42d3-a456-42661417400b",
      eventType: "project.deprovision",
    };
    await provisioner.deprovision(deletion);

    assert.deepEqual(await fs.readdir(path.join(root, "hermes/run/agents")), []);
    const quarantine = path.join(root, "trash/projects", deletion.eventId);
    assert.ok((await fs.readdir(quarantine)).includes("hermes-profile-demo_31"));
    assert.equal(restarts.length, 2);
  });
});
