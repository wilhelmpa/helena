import type { RuntimeLocalAi } from './local-ai';
import type { McpServerSpec, RuntimeId } from './runtime-profile';

// What Helena hands a runner for one agent (GET /agent-runtime/policy): its instructions,
// skills, MCP servers, vault access and learning settings, plus the owner's pending
// decisions. The runtime adapters (runtime-profile.ts) bring the runtime to it, and
// profile contributions add to it. Moved from packages/runner (hub/hermes-sync) so the
// API, the runner and plugins share one definition.

export interface RuntimePolicyFile {
  kind: 'instructions';
  path: string;
  content: string;
}

export interface RuntimeSkillFile {
  path: string;
  content: string;
}

export interface RuntimeSkill {
  id: number;
  slug: string;
  name: string;
  description: string;
  markdown: string;
  files: RuntimeSkillFile[];
}

// The parts of the knowledge vault the agent's file tools may reach, as absolute paths:
// a path is readable below an entry of `read`, writable below one of `write`, and
// neither below one of `deny`. Hermes gets it as VOLITION_VAULT_ACCESS (JSON) for its
// approval plugin to enforce.
export interface VaultAccess {
  root: string;
  read: string[];
  write: string[];
  deny: string[];
}

// A literal, or the id of one of the team's secrets, whose value the runner reads from
// Helena before each run and chat answer.
export type RuntimeMcpValue = { name: string; value: string } | { name: string; secret: number };

export interface RuntimeMcpServer {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string | null;
  args: string[];
  url: string | null;
  env: RuntimeMcpValue[];
  headers: RuntimeMcpValue[];
}

// What the agent learns itself: the memory it writes and the skills it creates.
export interface RuntimeLearning {
  // The agent keeps memory and creates skills.
  enabled: boolean;
  // Hermes' curator marks learned skills stale and archives them after a while unused.
  curator: boolean;
}

export type MemoryFile = 'MEMORY.md' | 'USER.md';

// An owner's decision Helena hands the runner with the policy. Each is carried out once,
// after the revision that carries it applied, and its result is reported back.
export type RuntimeAction =
  // Write the whole profile again and read it back ("Neu schreiben").
  | { id: number; kind: 'rewrite-profile' }
  | { id: number; kind: 'discard-skill'; path: string }
  | { id: number; kind: 'pin-skill'; path: string; pinned: boolean }
  | {
      id: number;
      kind: 'write-memory';
      file: MemoryFile;
      content: string;
      // The digest of the content the owner edited; a file the agent changed since is
      // not overwritten.
      baseSha256: string;
    };

// Whether the agent's own memory writes wait for the owner, and the approved content of each
// memory file, which the runner keeps the files at meanwhile.
export interface RuntimeMemoryPolicy {
  approval: boolean;
  baseline: { file: MemoryFile; sha256: string; content: string }[];
}

// Settings Helena keeps for the agent that Hermes reads from its configuration, written by
// the hermes-settings profile contribution: the skills turned off for it, the models Hermes
// falls back to when the primary one fails, and how long Hermes keeps ended sessions.
export interface RuntimeHermesSettings {
  skillsDisabled?: string[];
  fallbackModels?: { provider: string; model: string }[];
  sessionRetentionDays?: number | null;
  // How Hermes compresses a long conversation (compression.*, auxiliary.compression); an
  // older server sends none and Hermes' own defaults apply.
  compression?: RuntimeCompression;
  // Which of the skills that ship with Hermes the profile carries; the runner seeds them
  // with Hermes' own sync, the same way for every profile. An older server sends none and
  // the profile keeps what it has.
  bundledSkills?: 'all' | 'essential';
}

export interface RuntimeCompression {
  thresholdTokens: number;
  targetRatio?: number;
  idleCompactAfterSeconds?: number;
  model?: { provider: string; model: string } | null;
}

// Settings of Helena's own loop (runtime `helena`, docs/helena-decisions/zentrale-laufzeit.md):
// the tools of the agent's role and when it hands a task to a bigger model.
export interface RuntimeHelenaSettings {
  toolProfile?: 'assistent' | 'recherche' | 'coder-lite' | 'voll';
  escalation?: {
    mode?: 'auto' | 'never' | 'always';
    // A model this loop drives (`anthropic/claude-sonnet-5`) or `runtime:claude[/model]`,
    // `runtime:codex[/model]`, which Helena starts as a follow-up run.
    target?: string | null;
    taskKinds?: string[];
    confidenceBelow?: number;
    onFailure?: boolean;
    central?: import('./escalation').EscalationSettings;
    agentId?: number;
  };
  browserBudgetSeconds?: number;
}

export interface RuntimePolicySnapshot {
  revision: string;
  // The agent's configured model (null: the runtime's default). An older server sends none.
  model?: string | null;
  runtimePolicy: {
    files: RuntimePolicyFile[];
    commandScript?: string;
    webhookUrl?: string;
    webhookSecretEnv?: string;
    // The Hermes toolsets and MCP servers of the Hermes configuration the agent may not use.
    toolDeny?: string[];
  };
  skills: RuntimeSkill[];
  // The MCP servers of the team library enabled on the agent. An older server sends none.
  mcpServers?: RuntimeMcpServer[];
  // Whether website logins are granted to the agent. An older server sends none.
  webLogins?: boolean;
  vaultAccess?: VaultAccess;
  // Whether the agent learns. An older server sends none, and Hermes' own settings apply.
  learning?: RuntimeLearning;
  // Whether the agent's own memory writes wait for the owner. An older server sends none,
  // and memory writes take effect at once.
  memoryWrites?: RuntimeMemoryPolicy;
  // Helena's settings for Hermes' own configuration. An older server sends none.
  hermes?: RuntimeHermesSettings;
  // Settings of Helena's own loop; sent for an agent on the `helena` runtime.
  helena?: RuntimeHelenaSettings;
  // The local model servers and the helper calls that go there first, while local AI is on
  // (docs/helena-decisions/local-ai-platform.md). Absent while it is off.
  localAi?: RuntimeLocalAi | null;
  // The owner's decisions on what the agent learned, not carried out yet.
  actions?: RuntimeAction[];
}

// What the Hermes profile enables, as the deployment reads it from its config.yaml.
export interface HermesProfile {
  toolsets: string[];
  mcpServers: string[];
  plugins?: Record<string, string>;
  // The shared config.yaml every agent home links to (not set for the home that holds it).
  sharedConfig?: string;
  // The browser-harness MCP server's command, which the runner points at the project's
  // browser. Absent where the harness is not installed.
  browserHarness?: string;
}

// Profile contributions: what goes into an agent's runtime profile besides its
// instructions and skills. Helena's own MCP server, the project's browser, the team
// library's servers and the learning settings are built in (packages/runner
// contributions.ts); a plugin adds its own through `ctx.profileContributions`, and every
// runtime adapter picks it up the same way.
export interface ProfileContext {
  runtime: RuntimeId;
  snapshot: RuntimePolicySnapshot;
  // Where Helena's API answers, as the runner reaches it. Absent in a bare materializer.
  url?: string;
  // The runner config's environment for this agent (HERMES_HOME, BROWSER_CDP_URL, ...).
  env: Record<string, string>;
  hermes?: HermesProfile;
}

export interface ProfileContribution {
  id: string;
  // The MCP servers this contribution gives the agent.
  mcpServers?(context: ProfileContext): McpServerSpec[];
  // Library servers (snapshot.mcpServers) this contribution renders itself, so the library
  // contribution leaves them alone.
  claims?(context: ProfileContext): string[];
  // Servers that must be off, whoever else names them.
  suppress?(context: ProfileContext): string[];
  // Hermes toolsets the agent must not have, on top of what the owner turned off.
  denyToolsets?(context: ProfileContext): string[];
  // Keys merged into Hermes' managed configuration.
  hermesConfig?(context: ProfileContext): Record<string, unknown>;
}
