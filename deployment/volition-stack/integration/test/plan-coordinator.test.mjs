import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensurePlanCoordinator,
  ensureVerveCoder,
  PlanCoordinatorError,
} from "../plan-coordinator.mjs";

const project = { id: 7, teamId: 1, key: "SYSQA", name: "System QA" };
const config = {
  planInternalUrl: "http://127.0.0.1:3000",
  planApiKey: "owner-api-key",
  planDefaultDepartmentName: "Quality & Operations",
  planSecretAllowHost: "plan-api.example.com",
  openClawBin: "/test/openclaw",
};

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function fixture({ existing = false, hasSecret = false } = {}) {
  const agent = {
    id: 21,
    userId: "agent-user",
    name: "OpenClaw System QA Coordinator",
    username: "openclaw-sysqa-coordinator",
    kind: "external",
    projects: [project],
  };
  const state = {
    agent: existing ? structuredClone(agent) : null,
    secret: hasSecret,
    mapping: null,
    allowed: ["researcher", "writer", "reviewer", "tester"],
    organization: {
      teamId: 1,
      departments: [{ id: 4, name: "Quality & Operations" }],
      projects: [{ ...project, departmentId: 4, instructions: "Project scope" }],
      agents: [
        { id: 4, openClawAgentId: "coordinator", projects: [] },
        ...(existing
          ? [{ id: 21, openClawAgentId: null, departmentId: null, reportsToAgentId: null, projects: [project] }]
          : []),
      ],
    },
    created: 0,
    rotated: 0,
    stored: 0,
    mappingWrites: 0,
    reloads: 0,
    projectWrites: 0,
  };
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.headers["x-api-key"], config.planApiKey);
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    if (method === "GET" && path === "/teams/1/ai-agents") return json(200, state.agent ? [state.agent] : []);
    if (method === "POST" && path === "/teams/1/ai-agents") {
      state.created += 1;
      state.agent = structuredClone(agent);
      state.organization.agents.push({ id: 21, openClawAgentId: null, projects: [project] });
      return json(201, { agent: state.agent, apiKey: "created-key-value-1234567890" });
    }
    if (method === "POST" && path === "/teams/1/ai-agents/21/regenerate-key") {
      state.rotated += 1;
      return json(200, { apiKey: "rotated-key-value-1234567890" });
    }
    if (method === "PATCH" && path === "/teams/1/ai-agents/21") {
      Object.assign(state.agent, JSON.parse(init.body));
      return json(200, state.agent);
    }
    if (method === "PUT" && path === "/teams/1/ai-agents/21/projects") {
      state.projectWrites += 1;
      const body = JSON.parse(init.body);
      state.agent.projects = body.projectIds.map((id) =>
        id === project.id ? structuredClone(project) : { id, key: "OTHER", name: "Other" },
      );
      return json(200, state.agent);
    }
    if (method === "GET" && path === "/teams/1/organization") return json(200, state.organization);
    if (method === "PUT" && path === "/teams/1/organization/agents/21") {
      const body = JSON.parse(init.body);
      Object.assign(state.organization.agents.find((item) => item.id === 21), body);
      return json(200, body);
    }
    if (method === "PATCH" && path === "/teams/1/organization/agents/21/projects/7") {
      const body = JSON.parse(init.body);
      const assigned = state.organization.agents.find((item) => item.id === 21);
      const assignedProject = assigned.projects.find((item) => item.id === 7);
      assignedProject.instructions = body.instructions;
      return json(204, null);
    }
    throw new Error(`Unexpected HTTP ${method} ${path}`);
  };
  const runOpenClaw = async (args) => {
    if (args[0] === "secrets" && args[1] === "store" && args[2] === "list") {
      return { stdout: JSON.stringify(state.secret ? [{ name: "ITSAPLAN_SYSQA_COORDINATOR_API_KEY", kind: "secret", scopeKind: "team" }] : []) };
    }
    if (args[0] === "config" && args[1] === "set" && args[2].includes("itsaplan-runner")) {
      state.mapping = JSON.parse(args[3]);
      state.mappingWrites += 1;
      return { stdout: "{}" };
    }
    if (args[0] === "config" && args[1] === "get" && args[2].includes("itsaplan-runner")) {
      return { stdout: JSON.stringify({ ...state.mapping, apiKey: { ...state.mapping.apiKey, id: "__OPENCLAW_REDACTED__" } }) };
    }
    if (args[0] === "config" && args[1] === "get") return { stdout: JSON.stringify(state.allowed) };
    if (args[0] === "config" && args[1] === "set") {
      state.allowed = JSON.parse(args[3]);
      return { stdout: "{}" };
    }
    if (args[0] === "secrets" && args[1] === "reload") state.reloads += 1;
    if ((args[0] === "config" && args[1] === "validate") || (args[0] === "secrets" && args[1] === "reload")) {
      return { stdout: "{}" };
    }
    throw new Error(`Unexpected OpenClaw call ${args.join(" ")}`);
  };
  const storeSecret = async ({ name, value }) => {
    assert.equal(name, "ITSAPLAN_SYSQA_COORDINATOR_API_KEY");
    assert.match(value, /key-value/);
    state.secret = true;
    state.stored += 1;
  };
  const readRunnerMapping = async () => state.mapping;
  return { state, fetchImpl, runOpenClaw, storeSecret, readRunnerMapping };
}

describe("ensurePlanCoordinator", () => {
  it("creates, stores and maps one responsible project coordinator", async () => {
    const f = fixture();
    const result = await ensurePlanCoordinator(config, project, f);
    assert.equal(result.planAgentId, 21);
    assert.equal(result.nativeAgentId, "sysqa-coordinator");
    assert.equal(f.state.created, 1);
    assert.equal(f.state.stored, 1);
    assert.equal(f.state.rotated, 0);
    assert.equal(f.state.mapping.openclawAgentId, "sysqa-coordinator");
    assert.deepEqual(f.state.allowed, ["researcher", "writer", "reviewer", "tester", "sysqa-coordinator"]);
    const assigned = f.state.organization.agents.find((item) => item.id === 21);
    assert.deepEqual(
      { departmentId: assigned.departmentId, reportsToAgentId: assigned.reportsToAgentId, openClawAgentId: assigned.openClawAgentId },
      { departmentId: 4, reportsToAgentId: 4, openClawAgentId: "sysqa-coordinator" },
    );
  });

  it("reuses the existing agent and stored credential without rotation", async () => {
    const f = fixture({ existing: true, hasSecret: true });
    f.state.mapping = {
      openclawAgentId: "sysqa-coordinator",
      apiKey: { source: "store", provider: "default", id: "ITSAPLAN_SYSQA_COORDINATOR_API_KEY" },
    };
    const result = await ensurePlanCoordinator(config, project, f);
    assert.equal(result.planAgentId, 21);
    assert.equal(f.state.created, 0);
    assert.equal(f.state.stored, 0);
    assert.equal(f.state.rotated, 0);
    assert.equal(f.state.mappingWrites, 0);
    assert.equal(f.state.reloads, 0);
  });

  it("rotates only when an existing coordinator has no recoverable secret", async () => {
    const f = fixture({ existing: true, hasSecret: false });
    await ensurePlanCoordinator(config, project, f);
    assert.equal(f.state.rotated, 1);
    assert.equal(f.state.stored, 1);
  });

  it("removes accidental cross-project memberships from a dedicated coordinator", async () => {
    const f = fixture({ existing: true, hasSecret: true });
    f.state.agent.projects.push({ id: 9, teamId: 1, key: "OTHER", name: "Other" });
    await ensurePlanCoordinator(config, project, f);
    assert.equal(f.state.projectWrites, 1);
    assert.deepEqual(f.state.agent.projects.map((item) => item.id), [project.id]);
  });

  it("stores a newly issued key even when an older same-name store entry exists", async () => {
    const f = fixture({ existing: false, hasSecret: true });
    await ensurePlanCoordinator(config, project, f);
    assert.equal(f.state.created, 1);
    assert.equal(f.state.stored, 1);
  });

  it("preserves owner-customized organization roles and project instructions", async () => {
    const f = fixture({ existing: true, hasSecret: true });
    f.state.mapping = {
      openclawAgentId: "sysqa-coordinator",
      apiKey: { source: "store", provider: "default", id: "ITSAPLAN_SYSQA_COORDINATOR_API_KEY" },
    };
    const assigned = f.state.organization.agents.find((item) => item.id === 21);
    Object.assign(assigned, {
      openClawAgentId: "sysqa-coordinator",
      departmentId: 4,
      reportsToAgentId: null,
      roleTitle: "Custom QA Lead",
    });
    assigned.projects[0].instructions = "Custom owner-managed instructions";
    const result = await ensurePlanCoordinator(config, project, f);
    assert.equal(result.organization.roleTitle, "Custom QA Lead");
    assert.equal(result.organization.reportsToAgentId, null);
    assert.equal(result.organization.agentInstructions, "Custom owner-managed instructions");
  });

  it("fails closed for malformed projects and missing global coordination", async () => {
    const f = fixture({ existing: true, hasSecret: true });
    await assert.rejects(
      ensurePlanCoordinator(config, { ...project, key: "../BAD" }, f),
      PlanCoordinatorError,
    );
    f.state.organization.agents = f.state.organization.agents.filter((item) => item.id !== 4);
    await assert.rejects(ensurePlanCoordinator(config, project, f), /exactly one global coordinator/);
  });
});

describe("ensureVerveCoder", () => {
  it("keeps the existing coder on VERV only and enables assignment routing without rotating credentials", async () => {
    const verve = { id: 16, teamId: 1, key: "VERV", name: "Verve" };
    const state = {
      agent: {
        id: 32,
        userId: "verve-coder-user",
        name: "OpenClaw Verve Coder",
        username: "openclaw-verve-coder",
        kind: "external",
        triggerOnMention: true,
        triggerOnAssign: false,
        delegationDelaySec: 60,
        projects: [verve, { id: 99, teamId: 1, key: "TRAD", name: "Trading" }],
      },
      projectWrites: 0,
      patches: [],
    };
    const fetchImpl = async (url, init = {}) => {
      assert.equal(init.headers["x-api-key"], config.planApiKey);
      const requestPath = new URL(url).pathname;
      const method = init.method ?? "GET";
      if (method === "GET" && requestPath === "/teams/1/ai-agents") {
        return json(200, [state.agent]);
      }
      if (method === "PUT" && requestPath === "/teams/1/ai-agents/32/projects") {
        state.projectWrites += 1;
        assert.deepEqual(JSON.parse(init.body), { projectIds: [16] });
        state.agent.projects = [verve];
        return json(200, state.agent);
      }
      if (method === "PATCH" && requestPath === "/teams/1/ai-agents/32") {
        const body = JSON.parse(init.body);
        state.patches.push(body);
        Object.assign(state.agent, body);
        return json(200, state.agent);
      }
      throw new Error(`Unexpected HTTP ${method} ${requestPath}`);
    };
    const runOpenClaw = async (args) => {
      assert.deepEqual(args, ["secrets", "store", "list", "--json"]);
      return {
        stdout: JSON.stringify([
          {
            name: "ITSAPLAN_VERVE_CODER_API_KEY",
            kind: "secret",
            scopeKind: "team",
          },
        ]),
      };
    };
    const readRunnerMapping = async () => ({
      openclawAgentId: "verve-coder",
      apiKey: {
        source: "store",
        provider: "default",
        id: "ITSAPLAN_VERVE_CODER_API_KEY",
      },
    });
    const result = await ensureVerveCoder(config, verve, {
      fetchImpl,
      runOpenClaw,
      readRunnerMapping,
    });

    assert.equal(result.nativeAgentId, "verve-coder");
    assert.equal(state.projectWrites, 1);
    assert.deepEqual(state.agent.projects.map((item) => item.key), ["VERV"]);
    assert.deepEqual(state.patches, [{ triggerOnAssign: true, delegationDelaySec: 0 }]);
  });

  it("rejects use outside the VERV project", async () => {
    await assert.rejects(
      ensureVerveCoder(config, project, { runOpenClaw: async () => ({ stdout: "[]" }) }),
      /restricted to VERV/,
    );
  });
});
