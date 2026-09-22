import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createProvisioner,
  ProvisioningConflictError,
} from "../provisioner.mjs";

const EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const COORDINATOR_POLICY = {
  schemaVersion: 1,
  role: "project-coordinator",
  skills: [
    "volition-ticket-documentation",
    "volition-project-knowledge",
    "writing-plans",
  ],
  subagents: {
    delegationMode: "prefer",
    allowAgents: ["researcher", "writer", "reviewer", "tester"],
  },
  memory: {
    search: {
      enabled: true,
      rememberAcrossConversations: true,
      sources: ["memory", "sessions"],
    },
  },
  toolPolicy: { inheritExistingRole: true, allowAdditional: [] },
};
let temporaryRoot;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "volition-provisioner-"),
  );
  const policyDirectory = path.join(temporaryRoot, "openclaw/volition");
  await fs.mkdir(policyDirectory, { recursive: true });
  await fs.writeFile(
    path.join(policyDirectory, "coordinator-policy.json"),
    JSON.stringify(COORDINATOR_POLICY),
    { mode: 0o600 },
  );
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

function config() {
  const openClawRoot = path.join(temporaryRoot, "openclaw");
  return {
    projectsRoot: path.join(temporaryRoot, "projects"),
    verveProjectPath: path.join(temporaryRoot, "verve"),
    openClawBin: "/test/openclaw",
    openClawRoot,
    coordinatorPolicyPath: path.join(
      openClawRoot,
      "volition/coordinator-policy.json",
    ),
    agentWorkspaceRoot: path.join(openClawRoot, "workspace"),
    agentStateRoot: path.join(openClawRoot, "agents"),
    registryRoot: path.join(openClawRoot, "volition/projects"),
    ledgerPath: path.join(openClawRoot, "volition/ledger.json"),
    codeUrl: "https://code.example.com/",
    openClawUrl: "https://openclaw.example.com/",
    browserStartUrl: "https://example.com/",
    browserProfile: "openclaw",
    planInternalUrl: "http://127.0.0.1:3000/",
    planApiKey: "owner-api-key",
    planDefaultDepartmentName: "Quality & Operations",
    planSecretAllowHost: "plan-api.example.com",
  };
}

function envelope(overrides = {}) {
  return {
    eventId: EVENT_ID,
    eventType: "project.provision",
    project: {
      id: 7,
      key: "DEMO",
      name: "Demo",
      description: "",
      teamId: 3,
      ...overrides,
    },
    requestedResources: ["workspace", "coordinator", "files"],
    createdAt: "2026-09-21T00:00:00.000Z",
  };
}

function fakeOpenClaw() {
  const agents = [];
  const entries = Object.fromEntries(
    ["coordinator", "researcher", "writer", "reviewer", "tester", "verve-coder"].map((id) => [
      id,
      {
        tools: { profile: id === "verve-coder" ? "coding" : "standard" },
        sandbox: { mode: "all", workspaceAccess: "rw" },
        subagents: { allowAgents: [] },
      },
    ]),
  );
  const sessions = new Map();
  const widgets = new Map();
  let addCalls = 0;
  let widgetPutCalls = 0;
  let policyPatchCalls = 0;
  const subagentDefaults = { model: { primary: "openai/gpt-test" }, maxConcurrent: 4 };
  return {
    execute: async (_file, args) => {
      if (args[0] === "agents" && args[1] === "list") {
        return { stdout: JSON.stringify(agents), stderr: "" };
      }
      if (args[0] === "agents" && args[1] === "add") {
        addCalls += 1;
        const value = (flag) => args[args.indexOf(flag) + 1];
        agents.push({
          id: args[2],
          workspace: value("--workspace"),
          agentDir: value("--agent-dir"),
        });
        entries[args[2]] = {
          workspace: value("--workspace"),
          agentDir: value("--agent-dir"),
          tools: { profile: "coding", deny: ["group:messaging"] },
          sandbox: { mode: "all", workspaceAccess: "rw" },
        };
        return { stdout: JSON.stringify({ id: args[2] }), stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get") {
        if (args[2] === "agents.defaults.subagents") {
          return { stdout: JSON.stringify(subagentDefaults), stderr: "" };
        }
        return { stdout: JSON.stringify(entries), stderr: "" };
      }
      if (args[0] === "config" && args[1] === "set") {
        const match = /^agents\.entries\.([a-z0-9-]+)\.workspace$/.exec(args[2]);
        if (!match) throw new Error("Unexpected OpenClaw config set");
        const id = match[1];
        const agent = agents.find((item) => item.id === id);
        if (!agent) throw new Error("Missing seeded agent");
        agent.workspace = JSON.parse(args[3]);
        entries[id].workspace = agent.workspace;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      if (args[0] === "config" && args[1] === "patch") {
        const policyPatch = JSON.parse(
          await fs.readFile(args[args.indexOf("--file") + 1], "utf8"),
        );
        if (!args.includes("--dry-run")) {
          policyPatchCalls += 1;
          const patch = policyPatch.agents.entries;
          for (const [id, value] of Object.entries(patch)) {
            entries[id] = {
              ...entries[id],
              ...value,
              subagents: { ...entries[id]?.subagents, ...value.subagents },
              memory: {
                ...entries[id]?.memory,
                ...value.memory,
                search: {
                  ...entries[id]?.memory?.search,
                  ...value.memory?.search,
                },
              },
            };
          }
          Object.assign(subagentDefaults, policyPatch.agents.defaults?.subagents ?? {});
        }
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      if (args[0] === "skills" && args[1] === "check") {
        const id = args[args.indexOf("--agent") + 1];
        return {
          stdout: JSON.stringify({
            agentSkillFilter: entries[id].skills,
            modelVisible: entries[id].skills,
          }),
          stderr: "",
        };
      }
      if (args[0] === "gateway" && args[1] === "call") {
        const params = JSON.parse(args[args.indexOf("--params") + 1]);
        if (args[2] === "sessions.create") {
          const sessionId = sessions.get(params.key) ?? "session-1";
          sessions.set(params.key, sessionId);
          return {
            stdout: JSON.stringify({ ok: true, key: params.key, sessionId }),
            stderr: "",
          };
        }
        if (args[2] === "board.widget.put") {
          if (!sessions.has(params.sessionKey)) {
            throw new Error("The session does not exist");
          }
          widgetPutCalls += 1;
          widgets.set(params.sessionKey, {
            name: params.name,
            pluginKind: params.content.pluginKind,
            props: params.content.props,
          });
          return { stdout: JSON.stringify({ ok: true }), stderr: "" };
        }
        if (args[2] === "board.get") {
          const widget = widgets.get(params.sessionKey);
          return {
            stdout: JSON.stringify({
              sessionKey: params.sessionKey,
              widgets: widget ? [widget] : [],
            }),
            stderr: "",
          };
        }
      }
      throw new Error("Unexpected OpenClaw command");
    },
    addCalls: () => addCalls,
    widgetPutCalls: () => widgetPutCalls,
    policyPatchCalls: () => policyPatchCalls,
    entries,
    seedAgent(id, workspace, agentDir) {
      agents.push({ id, workspace, agentDir });
      entries[id] = {
        workspace,
        agentDir,
        tools: { profile: "coding", deny: ["group:messaging"] },
        sandbox: { mode: "all", workspaceAccess: "rw" },
      };
    },
  };
}

async function fakeFiles(slug) {
  return {
    kind: "files",
    id: `/Projects/${slug}`,
    url: `https://cloud.example.com/apps/files/files?dir=%2FProjects%2F${slug}`,
  };
}

async function fakeBoardFiles(slug, boardId) {
  return {
    id: `/Projects/${slug}/Boards/board-${boardId}`,
    url: `https://cloud.example.com/apps/files/files?dir=%2FProjects%2F${slug}%2FBoards%2Fboard-${boardId}`,
  };
}

async function fakePlanCoordinator(_config, project) {
  const slug = project.key === "VERV" ? "verve" : project.key.toLowerCase();
  return {
    planAgentId: 21,
    planAgentUserId: "agent-user",
    username: `openclaw-${slug}-coordinator`,
    nativeAgentId: `${slug}-coordinator`,
    credentialName: `ITSAPLAN_${slug.toUpperCase()}_COORDINATOR_API_KEY`,
    organization: { departmentId: 4, reportsToAgentId: 4 },
    globalDelegationChanged: false,
  };
}

describe("createProvisioner", () => {
  it("creates the workspace, coordinator and registry once for a repeated event", async () => {
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    const first = await provisioner.provision(envelope());
    const second = await provisioner.provision(envelope());

    assert.deepEqual(second, first);
    assert.equal(openClaw.addCalls(), 1);
    assert.equal(openClaw.policyPatchCalls(), 3);
    assert.deepEqual(
      openClaw.entries["demo-coordinator"].skills,
      COORDINATOR_POLICY.skills,
    );
    assert.deepEqual(
      first.resources.map((item) => item.kind),
      ["workspace", "registry", "coordinator", "files"],
    );
    const projectPath = path.join(temporaryRoot, "projects/demo");
    assert.equal((await fs.stat(projectPath)).isDirectory(), true);
    const registry = JSON.parse(
      await fs.readFile(
        path.join(temporaryRoot, "openclaw/volition/projects/demo.json"),
        "utf8",
      ),
    );
    assert.equal(registry.project.id, 7);
    assert.equal(registry.resources.coordinator.id, "demo-coordinator");
    assert.equal(registry.resources.coordinator.workspace, projectPath);
    assert.equal(
      registry.resources.coordinator.policy.schemaVersion,
      COORDINATOR_POLICY.schemaVersion,
    );
    assert.match(
      registry.resources.coordinator.policy.policyHash,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(registry.resources.files.path, "/Projects/demo");
  });

  it("reconciles only the delegated career agent's issue-state tool for KARR", async () => {
    const openClaw = fakeOpenClaw();
    const calls = [];
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
      ensureKarrCareerStateAccess: async (input) => {
        calls.push(input.agentId);
        return { changed: true, tools: ["itsaplan__update_issue"] };
      },
    });

    const result = await provisioner.provision(envelope({ key: "KARR" }));

    assert.deepEqual(calls, ["karriere-job"]);
    assert.deepEqual(
      result.resources.map((item) => item.kind),
      ["workspace", "registry", "coordinator", "files"],
    );
  });

  it("rejects reuse of an event id with another request", async () => {
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    await provisioner.provision(envelope());
    await assert.rejects(
      provisioner.provision(envelope({ name: "Different" })),
      ProvisioningConflictError,
    );
  });

  it("uses the existing Verve checkout without copying it", async () => {
    const settings = config();
    await fs.mkdir(settings.verveProjectPath, { recursive: true });
    await fs.writeFile(
      path.join(settings.verveProjectPath, "keep.txt"),
      "original",
    );
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(settings, {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    const result = await provisioner.provision(envelope({ key: "VERV" }));
    assert.equal(
      await fs.readFile(
        path.join(settings.verveProjectPath, "keep.txt"),
        "utf8",
      ),
      "original",
    );
    assert.equal(result.resources[0].id, "/projects/verve");
    assert.deepEqual(openClaw.entries["verve-coordinator"].subagents.allowAgents, [
      "coordinator",
      "researcher",
      "reviewer",
      "tester",
      "verve-coder",
      "writer",
    ]);
  });

  it("migrates only the known legacy coordinator workspace onto the project code root", async () => {
    const settings = config();
    const openClaw = fakeOpenClaw();
    openClaw.seedAgent(
      "demo-coordinator",
      path.join(settings.agentWorkspaceRoot, "demo-coordinator"),
      path.join(settings.agentStateRoot, "demo-coordinator/agent"),
    );
    const provisioner = createProvisioner(settings, {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    await provisioner.provision(envelope());
    assert.equal(
      openClaw.entries["demo-coordinator"].workspace,
      path.join(settings.projectsRoot, "demo"),
    );
  });

  it("uses a strict project-specific coordinator policy when the owner provides one", async () => {
    const settings = config();
    const specialized = {
      ...COORDINATOR_POLICY,
      skills: [...COORDINATOR_POLICY.skills, "volition-trading-research"],
    };
    await fs.writeFile(
      path.join(path.dirname(settings.coordinatorPolicyPath), "demo-coordinator.json"),
      JSON.stringify(specialized),
      { mode: 0o600 },
    );
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(settings, {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    await provisioner.provision(envelope());
    assert.deepEqual(openClaw.entries["demo-coordinator"].skills, specialized.skills);
  });

  it("creates and verifies a native browser dashboard for the project coordinator", async () => {
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensurePlanCoordinator: fakePlanCoordinator,
    });
    const request = envelope();
    request.requestedResources.push("browser");
    request.requestedResources.push("terminal");

    const first = await provisioner.provision(request);
    const second = await provisioner.provision(request);

    assert.deepEqual(second, first);
    assert.equal(openClaw.widgetPutCalls(), 1);
    assert.deepEqual(first.resources.slice(-3), [
      {
        kind: "terminal",
        id: "terminal-project:demo",
        url: "https://openclaw.example.com/focus/terminal-project/?arg=demo",
      },
      {
        kind: "session",
        id: "agent:demo-coordinator:main",
      },
      {
        kind: "browser",
        id: "agent:demo-coordinator:main/volition-browser",
        url: "https://openclaw.example.com/focus/dashboard/demo-coordinator",
      },
    ]);
    const registry = JSON.parse(
      await fs.readFile(
        path.join(temporaryRoot, "openclaw/volition/projects/demo.json"),
        "utf8",
      ),
    );
    assert.deepEqual(registry.resources.browser, {
      id: "agent:demo-coordinator:main/volition-browser",
      name: "volition-browser",
      sessionKey: "agent:demo-coordinator:main",
      sessionId: "session-1",
      profile: "openclaw",
      startUrl: "https://example.com/",
      url: "https://openclaw.example.com/focus/dashboard/demo-coordinator",
    });
    assert.deepEqual(registry.resources.terminal, {
      id: "terminal-project:demo",
      url: "https://openclaw.example.com/focus/terminal-project/?arg=demo",
    });
  });

  it("reports app-owned resources instead of pretending to provision them", async () => {
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
    });
    const request = envelope();
    request.requestedResources = ["boards", "workflows"];

    const result = await provisioner.provision(request);

    assert.deepEqual(result.resources, [{ kind: "registry", id: "project:demo" }]);
    assert.deepEqual(result.warnings, [
      "boards are managed inside It's a Plan and are not provisioned by this service.",
      "workflows are managed inside It's a Plan and are not provisioned by this service.",
    ]);
    assert.equal(openClaw.addCalls(), 0);
  });

  it("merges partial board events by stable id and keeps the latest rename", async () => {
    const openClaw = fakeOpenClaw();
    const provisioner = createProvisioner(config(), {
      execute: openClaw.execute,
      ensureFiles: fakeFiles,
      ensureBoardFiles: fakeBoardFiles,
    });
    const first = envelope();
    first.requestedResources = ["board:12"];
    first.boards = [
      { id: 12, resource: "board:12", name: "First", slug: "first" },
    ];
    await provisioner.provision(first);

    const second = envelope();
    second.eventId = "123e4567-e89b-42d3-a456-426614174001";
    second.requestedResources = ["board:13"];
    second.boards = [
      { id: 13, resource: "board:13", name: "Second", slug: "second" },
    ];
    await provisioner.provision(second);

    const renamed = envelope();
    renamed.eventId = "123e4567-e89b-42d3-a456-426614174002";
    renamed.requestedResources = ["board:12"];
    renamed.boards = [
      { id: 12, resource: "board:12", name: "Renamed", slug: "renamed" },
    ];
    await provisioner.provision(renamed);

    const registry = JSON.parse(
      await fs.readFile(
        path.join(temporaryRoot, "openclaw/volition/projects/demo.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      registry.boards.map(({ id, name }) => ({ id, name })),
      [
        { id: 12, name: "Renamed" },
        { id: 13, name: "Second" },
      ],
    );
  });
});
