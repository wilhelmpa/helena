// `policy-hook`: Claude Code's PreToolUse hook for a Helena run or chat answer. Claude Code
// runs it before each tool call with the call on stdin; it asks Helena's policy engine
// (POST /agent-policy/decide) and denies the call when the engine does not allow it. Helena
// classifies the call, applies the Autopilot level and the budgets, and logs the decision.
// A call Helena allows goes on to Claude Code's own permission mode. When Helena cannot be
// asked, the call is denied: a policy that cannot be checked does not hold.
import { runnerDisplayName } from './display-name';

export interface HookInput {
  tool_name?: unknown;
  tool_input?: unknown;
  cwd?: unknown;
}

// Claude Code's tools that only read or only talk within the task need no question.
const READ_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'NotebookRead',
  'TodoWrite',
  'Task',
  'Agent',
  'ExitPlanMode',
  'BashOutput',
]);

// Helena's own MCP tools are checked by Helena when they arrive.
function serverSideMcp(): Set<string> {
  return new Set(
    (process.env.HELENA_POLICY_SERVER_MCP ?? 'itsaplan,helena,plan')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

// The question for the engine, or null when the call needs none.
export function hookQuestion(
  input: HookInput,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> | null {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  if (!tool || READ_TOOLS.has(tool)) return null;
  const args =
    input.tool_input && typeof input.tool_input === 'object'
      ? (input.tool_input as Record<string, unknown>)
      : {};
  const body: Record<string, unknown> = {
    runtime: 'claude',
    tool: tool.slice(0, 200),
    ...(typeof input.cwd === 'string' && { workspace: input.cwd }),
  };
  const mcp = /^mcp__([^_].*?)__(.+)$/.exec(tool);
  if (mcp) {
    if (serverSideMcp().has(mcp[1]!)) return null;
    body.mcp = { server: mcp[1], annotations: null };
    body.tool = mcp[2]!.slice(0, 200);
  }
  if (typeof args.command === 'string') body.command = args.command;
  const path = args.file_path ?? args.notebook_path ?? args.path;
  if (typeof path === 'string') body.path = path;
  const runId = env.ITSAPLAN_RUN_ID;
  const messageId = env.ITSAPLAN_MESSAGE_ID;
  if (runId && /^\d+$/.test(runId)) body.runId = Number(runId);
  else if (messageId && /^\d+$/.test(messageId)) body.messageId = Number(messageId);
  return body;
}

function deny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

// What the hook prints: nothing for a call Helena allows (Claude Code's own permission mode
// takes it from there), a deny with Helena's message otherwise.
export async function runPolicyHook(
  stdin: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const displayName = runnerDisplayName(env);
  let input: HookInput;
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    return deny(`BLOCKED: ${displayName} could not read this tool call.`);
  }
  const question = hookQuestion(input, env);
  if (!question) return '';
  const url = env.ITSAPLAN_URL;
  const key = env.ITSAPLAN_API_KEY;
  if (!url || !key) return deny(`BLOCKED: ${displayName} cannot be asked about this call.`);
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/agent-policy/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(question),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${displayName} answered ${response.status}`);
    const decision = (await response.json()) as { outcome?: string; message?: string };
    if (decision.outcome === 'allow') return '';
    return deny(decision.message || `BLOCKED by ${displayName}'s Autopilot.`);
  } catch (error) {
    return deny(
      `BLOCKED: ${displayName} could not decide on this call (${error instanceof Error ? error.message : 'unknown error'}). ` +
        'Do not run it or reach the same result another way; end the run and report the problem.',
    );
  }
}
