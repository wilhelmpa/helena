import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensurePlanCoordinator, PlanCoordinatorError } from "../plan-coordinator.mjs";

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
