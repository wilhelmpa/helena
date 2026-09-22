import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  applyCoordinatorPolicy,
  activeTeamAgentIds,
  CoordinatorPolicyError,
  loadCoordinatorPolicy,
  reconcileTeamDelegation,
  validateCoordinatorPolicy,
} from "../coordinator-policy.mjs";

const POLICY = {
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
  toolPolicy: {
    inheritExistingRole: true,
    allowAdditional: [],
  },
};

let temporaryRoot;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coordinator-policy-"));
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

async function policyFile(value = POLICY, mode = 0o600) {
  const filePath = path.join(temporaryRoot, "coordinator-policy.json");
  await fs.writeFile(filePath, JSON.stringify(value), { mode });
  await fs.chmod(filePath, mode);
  return filePath;
}

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      merge(target[key], value);
    } else {
      target[key] = structuredClone(value);
    }
  }
}

function fakeOpenClaw({ visibleSkills = POLICY.skills } = {}) {
  const entries = {
    "demo-coordinator": {
      workspace: "/workspace/demo",
      skills: ["old-skill"],
      subagents: { allowAgents: ["researcher"] },
      tools: { profile: "coding", deny: ["group:messaging"] },
      sandbox: { mode: "all", workspaceAccess: "rw" },
    },
  };
  const defaults = {
    model: { primary: "openai/gpt-test" },
    maxConcurrent: 4,
  };
  const calls = [];
  return {
    entries,
    calls,
    async run(args) {
      calls.push({ args });
      if (args[0] === "config" && args[1] === "get") {
        if (args[2] === "agents.defaults.subagents") {
          return { stdout: JSON.stringify(defaults), stderr: "" };
        }
        return { stdout: JSON.stringify(entries), stderr: "" };
      }
      if (args[0] === "config" && args[1] === "patch") {
        const patch = JSON.parse(
          await fs.readFile(args[args.indexOf("--file") + 1], "utf8"),
        );
        if (!args.includes("--dry-run")) {
          merge(entries, patch.agents.entries);
          merge(defaults, patch.agents.defaults?.subagents ?? {});
        }
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      if (args[0] === "skills" && args[1] === "check") {
        return {
          stdout: JSON.stringify({
            agentSkillFilter: entries["demo-coordinator"].skills,
            modelVisible: visibleSkills,
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    },
  };
}

describe("coordinator policy", () => {
  it("loads only an owner-private, strictly shaped policy", async () => {
    const filePath = await policyFile();
    assert.deepEqual(await loadCoordinatorPolicy(filePath), POLICY);

    await fs.chmod(filePath, 0o640);
    await assert.rejects(
      loadCoordinatorPolicy(filePath),
      /owner-only regular file/,
    );

    const invalid = { ...POLICY, tools: { allow: ["*"] } };
    assert.throws(
      () => validateCoordinatorPolicy(invalid),
      CoordinatorPolicyError,
    );
    assert.throws(
      () =>
        validateCoordinatorPolicy({
          ...POLICY,
          subagents: { ...POLICY.subagents, allowAgents: ["*"] },
        }),
      /allowAgents is invalid/,
    );
    assert.throws(
      () =>
        validateCoordinatorPolicy({
          ...POLICY,
          toolPolicy: { inheritExistingRole: true, allowAdditional: ["exec"] },
        }),
      /must not grant tools/,
    );
  });

  it("patches only coordinator policy fields and verifies effective skills", async () => {
    const filePath = await policyFile();
    const openClaw = fakeOpenClaw();
    const protectedBefore = {
      tools: structuredClone(openClaw.entries["demo-coordinator"].tools),
      sandbox: structuredClone(openClaw.entries["demo-coordinator"].sandbox),
    };

    const result = await applyCoordinatorPolicy({
      agentId: "demo-coordinator",
      policyPath: filePath,
      runOpenClaw: openClaw.run,
    });

    assert.equal(result.changed, true);
    assert.match(result.policyHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(openClaw.entries["demo-coordinator"].skills, POLICY.skills);
    assert.deepEqual(openClaw.entries["demo-coordinator"].subagents, {
      delegationMode: "prefer",
      allowAgents: ["researcher", "reviewer", "tester", "writer"],
    });
    assert.deepEqual(openClaw.entries["demo-coordinator"].memory, POLICY.memory);
    assert.deepEqual(
      {
        tools: openClaw.entries["demo-coordinator"].tools,
        sandbox: openClaw.entries["demo-coordinator"].sandbox,
      },
      protectedBefore,
    );
    assert.equal(
      openClaw.calls.filter(
        ({ args }) => args[0] === "config" && args[1] === "patch",
      ).length,
      2,
    );
  });

  it("is idempotent after verification", async () => {
    const filePath = await policyFile();
    const openClaw = fakeOpenClaw();
    await applyCoordinatorPolicy({
      agentId: "demo-coordinator",
      policyPath: filePath,
      runOpenClaw: openClaw.run,
    });
    openClaw.calls.length = 0;

    const result = await applyCoordinatorPolicy({
      agentId: "demo-coordinator",
      policyPath: filePath,
      runOpenClaw: openClaw.run,
    });

    assert.equal(result.changed, false);
    assert.equal(
      openClaw.calls.some(
        ({ args }) => args[0] === "config" && args[1] === "patch",
      ),
      false,
    );
    assert.equal(
      openClaw.calls.some(
        ({ args }) => args[0] === "skills" && args[1] === "check",
      ),
      true,
    );
  });

  it("adds a project-specific specialist without widening tools or the shared policy file", async () => {
    const filePath = await policyFile();
    const openClaw = fakeOpenClaw({ visibleSkills: POLICY.skills });
    const result = await applyCoordinatorPolicy({
      agentId: "demo-coordinator",
      policyPath: filePath,
      runOpenClaw: openClaw.run,
      additionalAllowAgents: ["verve-coder"],
    });
    assert.equal(result.changed, true);
    assert.deepEqual(openClaw.entries["demo-coordinator"].subagents.allowAgents, [
      "researcher",
      "reviewer",
      "tester",
      "verve-coder",
      "writer",
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), POLICY);
  });

  it("reconciles an all-to-all work team while leaving processor roles and protected policy unchanged", async () => {
    const openClaw = fakeOpenClaw();
    openClaw.entries.researcher = {
      subagents: { allowAgents: [] },
      tools: { profile: "research" },
      sandbox: { mode: "all", workspaceAccess: "rw" },
    };
    openClaw.entries["verve-coder"] = {
      subagents: { allowAgents: ["reviewer"] },
      tools: { profile: "coding" },
      sandbox: { mode: "all", workspaceAccess: "rw" },
    };
    openClaw.entries["inbox-classifier"] = {
      subagents: { allowAgents: [] },
      tools: { deny: ["*"] },
      sandbox: { mode: "all", workspaceAccess: "none" },
    };
    const protectedBefore = structuredClone(openClaw.entries);
    const result = await reconcileTeamDelegation({ runOpenClaw: openClaw.run });

    assert.deepEqual(result.teamAgentIds, ["demo-coordinator", "researcher", "verve-coder"]);
    for (const id of result.teamAgentIds) {
      assert.deepEqual(
        openClaw.entries[id].subagents.allowAgents,
        result.teamAgentIds.filter((candidate) => candidate !== id),
      );
      assert.deepEqual(openClaw.entries[id].tools, protectedBefore[id].tools);
      assert.deepEqual(openClaw.entries[id].sandbox, protectedBefore[id].sandbox);
    }
    assert.deepEqual(openClaw.entries["inbox-classifier"], protectedBefore["inbox-classifier"]);
    assert.deepEqual(activeTeamAgentIds(openClaw.entries), result.teamAgentIds);
    assert.equal(result.maxSpawnDepth, 2);
    assert.equal(result.maxChildrenPerAgent, 4);
    assert.equal(result.maxConcurrent, 4);
    assert.equal((await reconcileTeamDelegation({ runOpenClaw: openClaw.run })).changed, false);
  });

  it("fails closed when a configured skill is not model-visible", async () => {
    const filePath = await policyFile();
    const openClaw = fakeOpenClaw({ visibleSkills: POLICY.skills.slice(0, 2) });
    await assert.rejects(
      applyCoordinatorPolicy({
        agentId: "demo-coordinator",
        policyPath: filePath,
        runOpenClaw: openClaw.run,
      }),
      /skills are not ready and visible/,
    );
  });
});
