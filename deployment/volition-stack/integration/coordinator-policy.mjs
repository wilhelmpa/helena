import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_POLICY_BYTES = 16 * 1024;
const AGENT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MEMORY_SOURCES = new Set(["memory", "sessions"]);
const TEAM_ROLE_IDS = new Set([
  "coordinator",
  "researcher",
  "writer",
  "reviewer",
  "tester",
  "verve-coder",
  "karriere-job",
  "karriere-triage",
]);
const NON_TEAM_AGENT_IDS = new Set([
  "inbox-classifier",
  "itsaplan-inbox",
  "trading-analyst",
]);
const MAX_TEAM_AGENTS = 32;

export class CoordinatorPolicyError extends Error {}

function exactKeys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoordinatorPolicyError(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new CoordinatorPolicyError(`${name} contains unsupported fields`);
  }
}

function uniqueStrings(value, name, pattern, minimum = 0, maximum = 16) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new CoordinatorPolicyError(`${name} is invalid`);
  }
  return [...value];
}

export function validateCoordinatorPolicy(value) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "role",
      "skills",
      "subagents",
      "memory",
      "toolPolicy",
    ],
    "coordinator policy",
  );
  if (value.schemaVersion !== 1 || value.role !== "project-coordinator") {
    throw new CoordinatorPolicyError("The coordinator policy version or role is unsupported");
  }
  const skills = uniqueStrings(value.skills, "skills", SKILL_ID, 1, 8);

  exactKeys(value.subagents, ["delegationMode", "allowAgents"], "subagents");
  if (value.subagents.delegationMode !== "prefer") {
    throw new CoordinatorPolicyError("subagents.delegationMode must be prefer");
  }
  const allowAgents = uniqueStrings(
    value.subagents.allowAgents,
    "subagents.allowAgents",
    AGENT_ID,
    1,
    MAX_TEAM_AGENTS,
  );

  exactKeys(value.memory, ["search"], "memory");
  exactKeys(
    value.memory.search,
    ["enabled", "rememberAcrossConversations", "sources"],
    "memory.search",
  );
  if (
    value.memory.search.enabled !== true ||
    value.memory.search.rememberAcrossConversations !== true
  ) {
    throw new CoordinatorPolicyError("Project coordinator memory must be enabled across conversations");
  }
  const sources = uniqueStrings(
    value.memory.search.sources,
    "memory.search.sources",
    /^[a-z]+$/,
    1,
    2,
  );
  if (sources.some((source) => !MEMORY_SOURCES.has(source))) {
    throw new CoordinatorPolicyError("memory.search.sources contains an unsupported source");
  }

  exactKeys(value.toolPolicy, ["inheritExistingRole", "allowAdditional"], "toolPolicy");
  if (
    value.toolPolicy.inheritExistingRole !== true ||
    !Array.isArray(value.toolPolicy.allowAdditional) ||
    value.toolPolicy.allowAdditional.length !== 0
  ) {
    throw new CoordinatorPolicyError("The coordinator policy must not grant tools");
  }

  return {
    schemaVersion: 1,
    role: "project-coordinator",
    skills,
    subagents: {
      delegationMode: "prefer",
      allowAgents,
    },
    memory: {
      search: {
        enabled: true,
        rememberAcrossConversations: true,
        sources,
      },
    },
    toolPolicy: {
      inheritExistingRole: true,
      allowAdditional: [],
    },
  };
}

export async function loadCoordinatorPolicy(filePath, options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const stat = await fileSystem.lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size > MAX_POLICY_BYTES ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new CoordinatorPolicyError("The coordinator policy must be an owner-only regular file");
  }
  let parsed;
  try {
    parsed = JSON.parse(await fileSystem.readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof CoordinatorPolicyError) throw error;
    throw new CoordinatorPolicyError("The coordinator policy is not valid JSON");
  }
  return validateCoordinatorPolicy(parsed);
}

function same(value, expected) {
  const canonical = (item) => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, canonical(item[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(canonical(value)) === JSON.stringify(canonical(expected));
}

function parseJsonOutput(result, name) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CoordinatorPolicyError(`OpenClaw returned invalid ${name} JSON`);
  }
}

async function readAgentEntry(runOpenClaw, agentId) {
  const entries = parseJsonOutput(
    await runOpenClaw(["config", "get", "agents.entries", "--json"]),
    "agent configuration",
  );
  const entry = entries?.[agentId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new CoordinatorPolicyError(`OpenClaw agent ${agentId} is missing`);
  }
  return entry;
}

async function readAgentEntries(runOpenClaw) {
  const entries = parseJsonOutput(
    await runOpenClaw(["config", "get", "agents.entries", "--json"]),
    "agent configuration",
  );
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new CoordinatorPolicyError("OpenClaw returned an invalid agent configuration");
  }
  return entries;
}

async function readSubagentDefaults(runOpenClaw) {
  const value = parseJsonOutput(
    await runOpenClaw(["config", "get", "agents.defaults.subagents", "--json"]),
    "subagent defaults",
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoordinatorPolicyError("OpenClaw returned invalid subagent defaults");
  }
  return value;
}

function isTeamAgentId(agentId) {
  return (
    AGENT_ID.test(agentId) &&
    !NON_TEAM_AGENT_IDS.has(agentId) &&
    (TEAM_ROLE_IDS.has(agentId) || agentId.endsWith("-coordinator"))
  );
}

export function activeTeamAgentIds(entries) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new CoordinatorPolicyError("Agent entries are invalid");
  }
  const ids = Object.keys(entries).filter(isTeamAgentId).sort();
  return uniqueStrings(ids, "active team agents", AGENT_ID, 1, MAX_TEAM_AGENTS);
}

function policyMatches(entry, policy) {
  return (
    same(entry.skills, policy.skills) &&
    entry.subagents?.delegationMode === policy.subagents.delegationMode &&
    same(entry.subagents?.allowAgents, policy.subagents.allowAgents) &&
    entry.memory?.search?.enabled === policy.memory.search.enabled &&
    entry.memory?.search?.rememberAcrossConversations ===
      policy.memory.search.rememberAcrossConversations &&
    same(entry.memory?.search?.sources, policy.memory.search.sources)
  );
}

function assertPolicyApplied(entry, policy) {
  if (!policyMatches(entry, policy)) {
    throw new CoordinatorPolicyError("OpenClaw did not confirm the coordinator policy");
  }
}

export async function applyCoordinatorPolicy({
  agentId,
  policyPath,
  runOpenClaw,
  loadPolicy = loadCoordinatorPolicy,
  additionalAllowAgents = [],
}) {
  if (!AGENT_ID.test(agentId)) {
    throw new CoordinatorPolicyError("The coordinator agent ID is invalid");
  }
  if (typeof runOpenClaw !== "function") {
    throw new CoordinatorPolicyError("runOpenClaw is required");
  }
  const loadedPolicy = await loadPolicy(policyPath);
  const added = uniqueStrings(
    additionalAllowAgents,
    "additionalAllowAgents",
    AGENT_ID,
    0,
    MAX_TEAM_AGENTS,
  );
  const policy = {
    ...loadedPolicy,
    subagents: {
      ...loadedPolicy.subagents,
      allowAgents: uniqueStrings(
        [...new Set([...loadedPolicy.subagents.allowAgents, ...added])].sort(),
        "effective subagents.allowAgents",
        AGENT_ID,
        1,
        MAX_TEAM_AGENTS,
      ),
    },
  };
  if (policy.subagents.allowAgents.includes(agentId)) {
    throw new CoordinatorPolicyError("A coordinator cannot delegate to itself");
  }

  const before = await readAgentEntry(runOpenClaw, agentId);
  const protectedBefore = {
    tools: before.tools,
    sandbox: before.sandbox,
  };
  let changed = false;
  if (!policyMatches(before, policy)) {
    const patch = JSON.stringify({
      agents: {
        entries: {
          [agentId]: {
            skills: policy.skills,
            subagents: policy.subagents,
            memory: policy.memory,
          },
        },
      },
    });
    const patchPath = path.join(
      path.dirname(policyPath),
      `.coordinator-policy.${process.pid}.${crypto.randomUUID()}.json`,
    );
    await fs.writeFile(patchPath, patch, { flag: "wx", mode: 0o600 });
    try {
      await runOpenClaw(["config", "patch", "--file", patchPath, "--dry-run"]);
      await runOpenClaw(["config", "patch", "--file", patchPath]);
    } finally {
      await fs.rm(patchPath, { force: true });
    }
    changed = true;
  }

  const after = await readAgentEntry(runOpenClaw, agentId);
  assertPolicyApplied(after, policy);
  if (
    !same(after.tools, protectedBefore.tools) ||
    !same(after.sandbox, protectedBefore.sandbox)
  ) {
    throw new CoordinatorPolicyError("Coordinator tool or sandbox policy changed unexpectedly");
  }

  const skillCheck = parseJsonOutput(
    await runOpenClaw(["skills", "check", "--agent", agentId, "--json"]),
    "skill check",
  );
  const visible = [...(skillCheck.modelVisible ?? [])].sort();
  const expected = [...policy.skills].sort();
  if (
    !same(skillCheck.agentSkillFilter, policy.skills) ||
    !same(visible, expected)
  ) {
    throw new CoordinatorPolicyError("Coordinator skills are not ready and visible");
  }

  const policyHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(policy))
    .digest("hex");
  return {
    schemaVersion: policy.schemaVersion,
    role: policy.role,
    policyHash,
    changed,
    verifiedAt: new Date().toISOString(),
  };
}

export async function reconcileTeamDelegation({ runOpenClaw }) {
  if (typeof runOpenClaw !== "function") {
    throw new CoordinatorPolicyError("runOpenClaw is required");
  }
  const before = await readAgentEntries(runOpenClaw);
  const defaultsBefore = await readSubagentDefaults(runOpenClaw);
  const defaultsTarget = {
    ...defaultsBefore,
    maxSpawnDepth: 2,
    maxChildrenPerAgent: 4,
  };
  const teamAgentIds = activeTeamAgentIds(before);
  const targetEntries = {};
  for (const agentId of teamAgentIds) {
    const entry = before[agentId];
    targetEntries[agentId] = {
      subagents: {
        ...(entry.subagents ?? {}),
        delegationMode: "prefer",
        allowAgents: teamAgentIds.filter((candidate) => candidate !== agentId),
      },
    };
  }
  const changed =
    !same(defaultsBefore, defaultsTarget) ||
    teamAgentIds.some(
      (agentId) => !same(before[agentId].subagents, targetEntries[agentId].subagents),
    );
  if (changed) {
    const patchPath = path.join(
      process.env.TMPDIR || "/tmp",
      `.team-delegation.${process.pid}.${crypto.randomUUID()}.json`,
    );
    await fs.writeFile(
      patchPath,
      JSON.stringify({
        agents: {
          defaults: { subagents: defaultsTarget },
          entries: targetEntries,
        },
      }),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await runOpenClaw(["config", "patch", "--file", patchPath, "--dry-run"]);
      await runOpenClaw(["config", "patch", "--file", patchPath]);
    } finally {
      await fs.rm(patchPath, { force: true });
    }
  }
  const after = await readAgentEntries(runOpenClaw);
  const defaultsAfter = await readSubagentDefaults(runOpenClaw);
  if (!same(defaultsAfter, defaultsTarget)) {
    throw new CoordinatorPolicyError("OpenClaw did not confirm bounded subagent defaults");
  }
  for (const agentId of teamAgentIds) {
    if (!same(after[agentId]?.subagents, targetEntries[agentId].subagents)) {
      throw new CoordinatorPolicyError(`OpenClaw did not confirm team delegation for ${agentId}`);
    }
    if (!same(after[agentId]?.tools, before[agentId]?.tools) || !same(after[agentId]?.sandbox, before[agentId]?.sandbox)) {
      throw new CoordinatorPolicyError(`OpenClaw changed protected policy for ${agentId}`);
    }
  }
  for (const agentId of NON_TEAM_AGENT_IDS) {
    if (before[agentId] && !same(after[agentId]?.subagents, before[agentId]?.subagents)) {
      throw new CoordinatorPolicyError(`OpenClaw changed excluded agent ${agentId}`);
    }
  }
  return {
    changed,
    teamAgentIds,
    maxSpawnDepth: defaultsAfter.maxSpawnDepth,
    maxChildrenPerAgent: defaultsAfter.maxChildrenPerAgent,
    maxConcurrent: defaultsAfter.maxConcurrent,
  };
}
