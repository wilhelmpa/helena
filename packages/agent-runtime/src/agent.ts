import { DEFAULTS, type AgentRuntimeConfig, type ToolProfile } from './config';
import type { EventSink } from './events';
import { HelenaClient, type HelenaApi, type MemoryState } from './helena-client';
import { uncertaintyEscalation, type Escalation } from './escalation';
import { runLoop, type LoopResult } from './loop';
import { modelChain, resolveModel, type ModelFactory, type ResolvedModel } from './models';
import { buildSystemPrompt } from './prompt';
import {
  FileSessionStore,
  HelenaSessionStore,
  MemorySessionStore,
  type SessionStore,
} from './session';
import {
  clarifyTool,
  findToolsTool,
  memoryTool,
  sessionSearchTool,
  skillTool,
  type ToolCatalogEntry,
} from './tools/builtin';
import { FILE_TOOLS } from './tools/files';
import { BROWSER_SERVER, connectMcp, mcpTools, type McpConnection } from './tools/mcp';
import { shellTool } from './tools/shell';
import type { AgentTool, PolicyQuestion } from './tools/types';

// One command of the loop, put together from its config: the models, the tools of the agent's
// role (Helena's MCP server, the project browser, files and shell in the working folder, the
// loop's own), its memory and skills in the system prompt, and the session store.

// Helena's own tools every role carries directly; the rest are found with find_tools.
export const CORE_HELENA_TOOLS = [
  'get_issue',
  'get_issue_by_number',
  'get_issue_why',
  'list_issues',
  'search_issues',
  'create_issue',
  'update_issue',
  'add_comment',
  'mark_issue_blocked',
  'request_approval',
  'report_output',
  'list_projects',
  'search_knowledge',
  'read_knowledge',
  'write_note',
  'capture_note',
  'decide',
  'fact_store',
  'fact_feedback',
];

const LOOP_TOOLS = ['clarify', 'find_tools', 'load_skill', 'memory', 'search_sessions'];
const FILE_TOOL_NAMES = FILE_TOOLS.map((entry) => entry.name);

// Which tools of the whole set a profile gives directly.
export function directTools(
  profile: ToolProfile,
  all: AgentTool[],
  core: string[] = CORE_HELENA_TOOLS,
): Set<string> {
  const names = new Set<string>();
  for (const entry of all) {
    if (LOOP_TOOLS.includes(entry.name) || core.includes(entry.name)) names.add(entry.name);
    if (profile === 'voll') names.add(entry.name);
    if ((profile === 'recherche' || profile === 'voll') && entry.kind === 'browser')
      names.add(entry.name);
    if (
      profile === 'coder-lite' &&
      (FILE_TOOL_NAMES.includes(entry.name) || entry.name === 'shell')
    ) {
      names.add(entry.name);
    }
  }
  return names;
}

export interface AgentRunInput {
  config: AgentRuntimeConfig;
  prompt: string;
  runContext?: string;
  sessionId?: string | null;
  labels?: string[];
  sink: EventSink;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  // For tests: the model factory and a Helena stand-in.
  modelFactory?: ModelFactory;
  helena?: HelenaApi | null;
  sessions?: SessionStore;
  extraTools?: AgentTool[];
}

function helenaOf(input: AgentRunInput): HelenaApi | null {
  if (input.helena !== undefined) return input.helena;
  const config = input.config.helena;
  // An isolated agent reaches Helena through its unit's forwarder, named in ITSAPLAN_URL.
  const url = input.env.ITSAPLAN_URL || config?.url;
  if (!config || !url) return null;
  const key = input.env[config.apiKeyEnv ?? 'ITSAPLAN_API_KEY'];
  if (!key) return null;
  return new HelenaClient(url, key, {
    runId: Number(input.env.ITSAPLAN_RUN_ID) || null,
    messageId: Number(input.env.ITSAPLAN_MESSAGE_ID) || null,
  });
}

function storeOf(input: AgentRunInput, helena: HelenaApi | null): SessionStore {
  if (input.sessions) return input.sessions;
  const kind = input.config.sessions?.store ?? (helena ? 'helena' : 'memory');
  if (kind === 'helena') {
    if (!helena) throw new Error('sessions in Helena need Helena');
    return new HelenaSessionStore(helena);
  }
  if (kind === 'file') {
    if (!input.config.sessions?.dir) throw new Error('file sessions need a dir');
    return new FileSessionStore(input.config.sessions.dir);
  }
  return new MemorySessionStore();
}

// Everything but Helena's hard blocks, for the evals' stand-in (policy "allow").
const EVAL_BLOCKED = /\b(pay|payment|kauf|bestell|credential|password|passwort)\b/i;

function policyOf(config: AgentRuntimeConfig, helena: HelenaApi | null) {
  return async (question: PolicyQuestion) => {
    if (config.policy === 'allow' || !helena) {
      if (EVAL_BLOCKED.test(`${question.tool} ${question.summary ?? ''}`)) {
        return { allowed: false, message: 'BLOCKED: this needs the owner.' };
      }
      return { allowed: true, message: '' };
    }
    return helena.decide({ ...question, runtime: 'helena', workspace: config.workdir });
  };
}

export async function runAgent(input: AgentRunInput): Promise<LoopResult> {
  const { config } = input;
  const helena = helenaOf(input);
  const connections: McpConnection[] = [];
  try {
    // ── models ──
    const { chain, skipped } = modelChain(
      config.model,
      config.fallbackModels,
      config.servers,
      config.reasoning,
      input.env,
      input.modelFactory,
    );
    for (const entry of skipped)
      process.stderr.write(`helena-agent: model ${entry.id} left out: ${entry.reason}\n`);
    let escalationModel: ResolvedModel | null = null;
    const target = config.escalation?.target;
    if (target && !target.startsWith('runtime:')) {
      try {
        escalationModel = resolveModel(
          target,
          config.servers,
          config.reasoning,
          input.env,
          input.modelFactory,
        );
      } catch (error) {
        process.stderr.write(`helena-agent: escalation model left out: ${String(error)}\n`);
      }
    }

    // ── tools ──
    const tools: AgentTool[] = [clarifyTool];
    const taken = new Set<string>([
      'clarify',
      'find_tools',
      'load_skill',
      'memory',
      'search_sessions',
    ]);
    const serverInstructions: { server: string; text: string }[] = [];
    for (const spec of config.mcpServers ?? []) {
      try {
        const connection = await connectMcp(spec, input.env);
        connections.push(connection);
        const listed = await mcpTools(connection, spec, taken);
        tools.push(...listed.tools);
        if (spec.name === BROWSER_SERVER) serverInstructions.push(...listed.instructions);
      } catch (error) {
        process.stderr.write(
          `helena-agent: MCP server ${spec.name} unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
    const profile = config.tools?.profile ?? 'assistent';
    const shellAllowed =
      profile === 'coder-lite' || profile === 'voll'
        ? input.env.HELENA_ISOLATED === '1' || config.tools?.allowUnsandboxedShell === true
        : false;
    if (profile === 'coder-lite' || profile === 'voll') tools.push(...FILE_TOOLS);
    if (shellAllowed) {
      tools.push(
        shellTool({
          timeoutMs: (config.tools?.shellTimeoutSeconds ?? DEFAULTS.shellTimeoutSeconds) * 1000,
          delivered: (input.env.HELENA_DELIVERED_ENV ?? '').split(',').filter(Boolean),
        }),
      );
    }
    const skills = config.skills ?? [];
    if (skills.length > 0) tools.push(skillTool(skills));
    let memory: MemoryState | null = null;
    if (helena && config.memory?.enabled !== false) {
      tools.push(memoryTool(helena), sessionSearchTool(helena));
      memory = await helena.memory().catch((error) => {
        process.stderr.write(`helena-agent: memory unavailable: ${String(error)}\n`);
        return null;
      });
    }
    tools.push(...(input.extraTools ?? []));
    const direct = directTools(profile, tools, config.tools?.core);
    const catalog = (): ToolCatalogEntry[] =>
      tools
        .filter((entry) => !direct.has(entry.name))
        .map(({ name, description }) => ({ name, description }));
    if (catalog().length > 0) {
      const finder = findToolsTool(catalog);
      tools.push(finder);
      direct.add(finder.name);
    }

    const system = buildSystemPrompt({
      instructions: config.instructions,
      runContext: input.runContext,
      memory,
      skills,
      serverInstructions,
      workdir: config.workdir,
    });

    // The decision service's view of the task (Helena's `decide` tool), asked only where the
    // owner set a confidence threshold for the hand-over.
    const decider = tools.find((entry) => entry.name === 'decide');
    const escalation = config.escalation;
    const uncertainty =
      decider &&
      escalation?.target &&
      (escalation.mode ?? 'auto') === 'auto' &&
      escalation.confidenceBelow !== undefined
        ? async (): Promise<Escalation | null> => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            try {
              const answer = await decider.execute(
                {
                  question:
                    'Can a small local model finish this task on its own with tools, or does it need a large model (hard coding, architecture, security, legal, text for outsiders)?',
                  options: [
                    { id: 'small', label: 'small model is enough' },
                    { id: 'large', label: 'needs a large model' },
                  ],
                  context: input.prompt.slice(0, 6000),
                },
                { workdir: config.workdir, signal: controller.signal, env: input.env },
              );
              const parsed = JSON.parse(answer.text) as {
                status?: string;
                choice?: string | null;
                confidence?: number;
              };
              // Undecided: the loop tries itself; a failure still hands the task over.
              if (parsed.status !== 'decided') return null;
              return uncertaintyEscalation(escalation, {
                label: parsed.choice === 'large' ? 'hard' : 'easy',
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1,
              });
            } catch {
              return null;
            } finally {
              clearTimeout(timer);
            }
          }
        : undefined;

    return await runLoop({
      ...(uncertainty && { uncertainty }),
      config,
      prompt: input.prompt,
      system,
      sessionId: input.sessionId ?? null,
      labels: input.labels,
      models: chain,
      escalationModel,
      tools,
      direct,
      sessions: storeOf(input, helena),
      sink: input.sink,
      policy: policyOf(config, helena),
      env: input.env,
      signal: input.signal,
      ...(helena && { note: (text: string) => helena.note(text) }),
    });
  } finally {
    await Promise.all(connections.map((connection) => connection.close()));
  }
}
