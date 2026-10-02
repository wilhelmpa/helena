// A tool of the loop: what the model sees (name, description, JSON Schema of its input) and
// what Helena does when it is called. Tools run one after another; each has its own deadline.

import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

// The question for Helena's policy engine (POST /agent-policy/decide), or null when the call
// needs none (it only reads, or Helena checks it where it lands).
export interface PolicyQuestion {
  tool: string;
  command?: string;
  path?: string;
  mcp?: { server: string; annotations: Record<string, unknown> | null };
  summary?: string;
}

export interface ToolContext {
  workdir: string;
  signal: AbortSignal;
  env: Record<string, string | undefined>;
  // Calls a tool of the loop by name (find_tools uses it to check a name).
  hasTool?(name: string): boolean;
}

export interface ToolOutput {
  text: string;
  isError?: boolean;
  // The call changed something (a file, a page), which resets the loop detection.
  changed?: boolean;
  // The turn ends after this call: the agent asked the person (clarify).
  endTurn?: boolean;
  // Tools to make callable from the next step on (find_tools).
  activate?: string[];
  // What the loop reads besides the text: a shell command's exit code and whether it ran
  // tests (two red test runs in a row are a failure the loop hands over).
  outcome?: 'ok' | 'nonzero_with_output' | 'error';
  exitCode?: number | null;
  test?: boolean;
}

export type ToolKind = 'normal' | 'shell' | 'browser' | 'clarify' | 'meta';

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  kind?: ToolKind;
  // Milliseconds this tool may take; the loop's default otherwise.
  timeoutMs?: number;
  // Whether it only reads (no policy question, and not a change for the loop detection).
  readOnly?: boolean;
  question?(input: Record<string, unknown>): PolicyQuestion | null;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

const inputValidator = new AjvJsonSchemaValidator();
const validators = new WeakMap<AgentTool, ReturnType<typeof inputValidator.getValidator>>();

export async function executeTool(
  tool: AgentTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutput> {
  let validate = validators.get(tool);
  if (!validate) {
    validate = inputValidator.getValidator(
      tool.inputSchema as Parameters<typeof inputValidator.getValidator>[0],
    );
    validators.set(tool, validate);
  }
  const result = validate(input);
  if (!result.valid) return error(`Invalid ${tool.name} arguments: ${result.errorMessage}`);
  return tool.execute(input, ctx);
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function error(message: string): ToolOutput {
  return { text: message, isError: true };
}
