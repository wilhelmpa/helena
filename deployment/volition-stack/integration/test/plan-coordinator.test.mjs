import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensurePlanCoordinator,
  ensurePlanProjectAgent,
  PlanCoordinatorError,
} from "../plan-coordinator.mjs";

const project = { id: 7, teamId: 1, key: "SYSQA", name: "System QA" };
const workspace = { slug: "sysqa", hostPath: "/work/projects/sysqa", containerPath: "/projects/sysqa" };
const config = {
  planInternalUrl: "http://127.0.0.1:3000",
  planApiKey: "owner-api-key",
  planDefaultDepartmentName: "Quality & Operations",
  hermesHome: "/data/hermes",
  hermesAgentsRoot: "/data/hermes/agents",
  hermesRunnerDescriptorRoot: "/data/hermes/run/agents",
};

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function fixture({ existing = false, descriptor = false } = {}) {
  const agent = {
    id: 21,
    userId: "agent-user",
    name: "Hermes SYSQA Coordinator",
    username: "hermes-sysqa-coordinator",
    kind: "external",
    projects: [project],
  };
  const state = {
    agent: existing ? structuredClone(agent) : null,
    descriptor: descriptor ? {
      schemaVersion: 1, projectId: 7, teamId: 1, planAgentId: 21,
      username: "hermes-sysqa-coordinator", cwd: workspace.hostPath,
      hermesHome: "/data/hermes/profiles/sysqa", globalHermesHome: "/data/hermes",
      apiKey: "existing-key-value-1234567890",
    } : null,
    created: 0, rotated: 0, writes: 0,
    organization: {
      teamId: 1,
      departments: [{ id: 4, name: "Quality & Operations" }],
      projects: [{ ...project, departmentId: 4, instructions: "Project scope" }],
      agents: existing ? [{ id: 21, runtimeAgentId: null, projects: [structuredClone(project)] }] : [],
    },
  };
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.headers["x-api-key"], config.planApiKey);
    const pathname = new URL(url).pathname;
    const method = init.method ?? "GET";
    if (method === "GET" && pathname === "/teams/1/ai-agents") return json(200, state.agent ? [state.agent] : []);
    if (method === "GET" && pathname === "/teams/1/ai-agents?projectId=7") return json(200, state.agent ? [state.agent] : []);
    if (method === "POST" && pathname === "/teams/1/ai-agents") {
      state.created += 1;
      state.agent = structuredClone(agent);
      state.organization.agents.push({ id: 21, runtimeAgentId: null, projects: [structuredClone(project)] });
      return json(201, { agent: state.agent, apiKey: "created-key-value-1234567890" });
    }
    if (method === "POST" && pathname === "/teams/1/ai-agents/21/regenerate-key") {
      state.rotated += 1;
      return json(200, { apiKey: "rotated-key-value-1234567890" });
    }
    if (method === "GET" && pathname === "/teams/1/organization") return json(200, state.organization);
    if (method === "PUT" && pathname === "/teams/1/organization/agents/21") {
      Object.assign(state.organization.agents[0], JSON.parse(init.body));
      return json(200, state.organization.agents[0]);
    }
    if (method === "PATCH" && pathname === "/teams/1/organization/agents/21/projects/7") {
      state.organization.agents[0].projects[0].instructions = JSON.parse(init.body).instructions;
      return json(204, null);
    }
    throw new Error("Unexpected HTTP " + method + " " + pathname);
  };
  const descriptorStore = {
    read: async (_path, expected) => {
      if (!state.descriptor) return null;
      assert.equal(expected.username, "hermes-sysqa-coordinator");
      return structuredClone(state.descriptor);
    },
    write: async (_path, value) => { state.writes += 1; state.descriptor = structuredClone(value); },
  };
  return { state, fetchImpl, descriptorStore, workspace };
}

describe("ensurePlanCoordinator", () => {
  it("creates a private Hermes descriptor and records the Hermes identity", async () => {
    const f = fixture();
    f.browser = { cdpUrl: "http://127.0.0.1:19201" };
    const result = await ensurePlanCoordinator(config, project, f);
    assert.equal(result.username, "hermes-sysqa-coordinator");
    assert.equal(result.hermesIdentity, result.username);
    assert.equal(f.state.created, 1);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.rotated, 0);
    assert.equal(f.state.descriptor.cwd, workspace.hostPath);
    assert.equal(f.state.descriptor.hermesHome, "/data/hermes/profiles/sysqa");
    assert.equal(f.state.descriptor.browserCdpUrl, "http://127.0.0.1:19201");
    assert.equal(f.state.organization.agents[0].runtimeAgentId, "hermes-sysqa-coordinator");
    assert.equal(f.state.organization.agents[0].role, "coordinator");
  });

  it("reuses an intact private descriptor without rotating a Plan key", async () => {
    const f = fixture({ existing: true, descriptor: true });
    await ensurePlanCoordinator(config, project, f);
    assert.equal(f.state.created, 0);
    assert.equal(f.state.rotated, 0);
    assert.equal(f.state.writes, 0);
  });

  it("rotates only when no private descriptor can recover the key", async () => {
    const f = fixture({ existing: true });
    await ensurePlanCoordinator(config, project, f);
    assert.equal(f.state.rotated, 1);
    assert.equal(f.state.writes, 1);
  });

  it("fails closed for malformed projects or a conflicting descriptor", async () => {
    const f = fixture({ existing: true });
    await assert.rejects(ensurePlanCoordinator(config, { ...project, key: "../BAD" }, f), PlanCoordinatorError);
    f.descriptorStore.read = async () => ({ apiKey: "bad" });
    await assert.rejects(ensurePlanCoordinator(config, project, f), PlanCoordinatorError);
    await assert.rejects(
      ensurePlanCoordinator(config, project, {
        ...fixture(),
        browser: { cdpUrl: "http://192.168.1.10:9222" },
      }),
      /CDP endpoint/,
    );
  });
});

describe("ensurePlanCoordinator with the Plan control token", () => {
  const controlConfig = {
    planInternalUrl: "http://127.0.0.1:3000",
    planControlToken: "control-token-value-with-at-least-32-bytes",
    hermesHome: "/data/hermes",
    hermesAgentsRoot: "/data/hermes/agents",
    hermesRunnerDescriptorRoot: "/data/hermes/run/agents",
  };

  function controlled() {
    const state = { validKey: null, issued: 0, offered: [], writes: 0, descriptor: null };
    const fetchImpl = async (url, init) => {
      assert.equal(new URL(url).pathname, "/internal/bootstrap/project-coordinator");
      assert.equal(init.headers.Authorization, `Bearer ${controlConfig.planControlToken}`);
      const body = JSON.parse(init.body);
      assert.equal(body.projectId, project.id);
      state.offered.push(body.apiKey ?? null);
      let apiKey = null;
      if (!body.apiKey || body.apiKey !== state.validKey) {
        state.issued += 1;
        apiKey = `issued-key-value-${state.issued}-1234567890`;
        state.validKey = apiKey;
      }
      return json(200, {
        agent: { id: 21, userId: "agent-user", username: "hermes-sysqa-coordinator" },
        apiKey,
        projectInstructions: "",
        agentInstructions: "",
      });
    };
    const descriptorStore = {
      read: async () => structuredClone(state.descriptor),
      write: async (_path, value) => { state.writes += 1; state.descriptor = structuredClone(value); },
    };
    return { state, options: { fetchImpl, descriptorStore, workspace } };
  }

  it("issues a key and writes the descriptor when none exists", async () => {
    const { state, options } = controlled();
    const result = await ensurePlanCoordinator(controlConfig, project, options);
    assert.equal(result.descriptorChanged, true);
    assert.deepEqual(state.offered, [null]);
    assert.equal(state.descriptor.apiKey, state.validKey);
    assert.equal(state.descriptor.hermesHome, "/data/hermes/profiles/sysqa");
  });

  it("keeps a valid key and leaves an unchanged descriptor alone", async () => {
    const { state, options } = controlled();
    await ensurePlanCoordinator(controlConfig, project, options);
    const key = state.validKey;

    const result = await ensurePlanCoordinator(controlConfig, project, options);
    assert.equal(result.descriptorChanged, false);
    assert.deepEqual(state.offered, [null, key]);
    assert.equal(state.issued, 1);
    assert.equal(state.writes, 1);
  });

  it("rewrites the descriptor with the same key when only the browser changed", async () => {
    const { state, options } = controlled();
    await ensurePlanCoordinator(controlConfig, project, options);
    const result = await ensurePlanCoordinator(controlConfig, project, {
      ...options,
      browser: { cdpUrl: "http://127.0.0.1:19202" },
    });
    assert.equal(result.descriptorChanged, true);
    assert.equal(state.issued, 1);
    assert.equal(state.descriptor.browserCdpUrl, "http://127.0.0.1:19202");
  });

  it("replaces a rejected key", async () => {
    const { state, options } = controlled();
    await ensurePlanCoordinator(controlConfig, project, options);
    state.validKey = "revoked-elsewhere";
    const result = await ensurePlanCoordinator(controlConfig, project, options);
    assert.equal(result.descriptorChanged, true);
    assert.equal(state.issued, 2);
    assert.equal(state.descriptor.apiKey, state.validKey);
  });

  it("never offers the key of a descriptor that belongs to another project", async () => {
    const { state, options } = controlled();
    state.descriptor = { projectId: 99, username: "hermes-sysqa-coordinator", apiKey: "other-project-key-1234567890" };
    await ensurePlanCoordinator(controlConfig, project, options);
    assert.deepEqual(state.offered, [null]);
  });
});

describe("ensurePlanProjectAgent", () => {
  const controlConfig = {
    planInternalUrl: "http://127.0.0.1:3000",
    planControlToken: "control-token-value-with-at-least-32-bytes",
    hermesHome: "/data/hermes",
    hermesAgentsRoot: "/data/hermes/agents",
    hermesRunnerDescriptorRoot: "/data/hermes/run/agents",
  };

  function agentRuntime({ answeredId = 31 } = {}) {
    const state = { validKey: null, issued: 0, offered: [], writes: [], descriptor: null };
    const fetchImpl = async (url, init) => {
      assert.equal(new URL(url).pathname, "/internal/bootstrap/project-agent");
      assert.equal(init.headers.Authorization, `Bearer ${controlConfig.planControlToken}`);
      const body = JSON.parse(init.body);
      assert.deepEqual([body.projectId, body.agentId], [project.id, 31]);
      state.offered.push(body.apiKey ?? null);
      let apiKey = null;
      if (!body.apiKey || body.apiKey !== state.validKey) {
        state.issued += 1;
        apiKey = `agent-key-value-${state.issued}-1234567890`;
        state.validKey = apiKey;
      }
      return json(200, { agent: { id: answeredId, userId: "coder-user", username: "Coder.Bot" }, apiKey });
    };
    const descriptorStore = {
      read: async () => structuredClone(state.descriptor),
      write: async (filePath, value) => {
        state.writes.push(filePath);
        state.descriptor = structuredClone(value);
      },
    };
    return {
      state,
      options: { fetchImpl, descriptorStore, workspace, browser: { cdpUrl: "http://127.0.0.1:19201" } },
    };
  }

  it("writes a descriptor with its own profile, the project's workspace and browser", async () => {
    const { state, options } = agentRuntime();
    const result = await ensurePlanProjectAgent(controlConfig, project, 31, options);

    assert.deepEqual(result, {
      planAgentId: 31,
      username: "Coder.Bot",
      name: "sysqa_31",
      hermesHome: "/data/hermes/profiles/sysqa_31",
      descriptorChanged: true,
    });
    assert.deepEqual(state.writes, ["/data/hermes/run/agents/sysqa_31.json"]);
    assert.deepEqual(state.descriptor, {
      schemaVersion: 1,
      projectId: 7,
      teamId: 1,
      planAgentId: 31,
      username: "Coder.Bot",
      cwd: workspace.hostPath,
      hermesHome: "/data/hermes/profiles/sysqa_31",
      globalHermesHome: "/data/hermes",
      browserCdpUrl: "http://127.0.0.1:19201",
      apiKey: state.validKey,
    });
  });

  it("keeps a valid key and an unchanged descriptor", async () => {
    const { state, options } = agentRuntime();
    await ensurePlanProjectAgent(controlConfig, project, 31, options);
    const key = state.validKey;

    const result = await ensurePlanProjectAgent(controlConfig, project, 31, options);
    assert.equal(result.descriptorChanged, false);
    assert.deepEqual(state.offered, [null, key]);
    assert.equal(state.writes.length, 1);
  });

  it("never offers the key of another agent's descriptor", async () => {
    const { state, options } = agentRuntime();
    state.descriptor = { projectId: 7, planAgentId: 32, username: "other", apiKey: "other-agent-key-1234567890" };
    await ensurePlanProjectAgent(controlConfig, project, 31, options);
    assert.deepEqual(state.offered, [null]);
  });

  it("fails closed for another agent in the answer or without the control token", async () => {
    await assert.rejects(
      ensurePlanProjectAgent(controlConfig, project, 31, agentRuntime({ answeredId: 32 }).options),
      PlanCoordinatorError,
    );
    await assert.rejects(
      ensurePlanProjectAgent({ ...controlConfig, planControlToken: "" }, project, 31, agentRuntime().options),
      /control token/,
    );
    await assert.rejects(
      ensurePlanProjectAgent(controlConfig, project, 0, agentRuntime().options),
      PlanCoordinatorError,
    );
  });
});
