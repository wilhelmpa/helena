// A plain tool loop over an OpenAI-compatible chat API with MCP tools: the model asks for tools,
// the loop calls them and hands the results back, until the model answers without a tool call,
// the turns run out or the time is up. What the practice test "Flash als Home" drives
// (run.ts); deliberately small, the shape Phase 3's own runtime starts from
// (docs/plan-lokal-halogen.md). No database, no Helena: the caller brings `post` and `callTool`.

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolCallRecord {
  turn: number;
  name: string;
  arguments: string;
  // The arguments parsed and the tool known and answering without an error.
  ok: boolean;
  error: string | null;
  ms: number;
}

export interface LoopResult {
  answer: string;
  turns: number;
  toolCalls: ToolCallRecord[];
  // The same tool with the same arguments right after itself.
  loops: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  stopped: 'answered' | 'turns' | 'time' | 'error';
  error: string | null;
}

// MCP tools as OpenAI function tools; the description clipped (the model needs what a tool
// is for, not its whole manual), the schema as it is.
export function toOpenAiTools(tools: McpTool[], maxDescription = 600): OpenAiTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: (tool.description ?? '').slice(0, maxDescription),
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

export function clip(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters)`
    : text;
}

export interface Completion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface LoopOptions {
  system: string;
  prompt: string;
  tools: OpenAiTool[];
  // One chat completion (the body as sent); the loop adds messages and tools.
  post(body: Record<string, unknown>): Promise<Completion>;
  // One tool call; throws or answers `isError` for a failure.
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }>;
  maxTurns: number;
  deadlineMs: number;
  maxResultChars?: number;
  // Extra fields of every request (reasoning_effort, max_tokens).
  request?: Record<string, unknown>;
  now?(): number;
}

export async function runToolLoop(options: LoopOptions): Promise<LoopResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const known = new Set(options.tools.map((tool) => tool.function.name));
  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.prompt },
  ];
  const result: LoopResult = {
    answer: '',
    turns: 0,
    toolCalls: [],
    loops: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    stopped: 'turns',
    error: null,
  };
  let last: string | null = null;
  for (let turn = 1; turn <= options.maxTurns; turn++) {
    if (now() - started > options.deadlineMs) {
      result.stopped = 'time';
      break;
    }
    result.turns = turn;
    let completion: Completion;
    try {
      completion = await options.post({
        ...options.request,
        messages,
        tools: options.tools,
        tool_choice: 'auto',
      });
    } catch (error) {
      result.stopped = 'error';
      result.error = error instanceof Error ? error.message : String(error);
      break;
    }
    result.inputTokens += completion.usage?.prompt_tokens ?? 0;
    result.outputTokens += completion.usage?.completion_tokens ?? 0;
    const message = completion.choices?.[0]?.message ?? {};
    const calls = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id || `call_${turn}_${index}`,
      type: 'function' as const,
      function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' },
    }));
    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(calls.length > 0 && { tool_calls: calls }),
    });
    if (calls.length === 0) {
      result.answer = message.content ?? '';
      result.stopped = 'answered';
      break;
    }
    for (const call of calls) {
      const began = now();
      const signature = `${call.function.name} ${call.function.arguments}`;
      if (signature === last) result.loops++;
      last = signature;
      let text: string;
      let ok = false;
      let error: string | null = null;
      let args: Record<string, unknown> | null = null;
      try {
        const parsed = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('arguments must be a JSON object');
        args = parsed as Record<string, unknown>;
      } catch (parseError) {
        error = `invalid arguments: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      }
      if (args && !known.has(call.function.name)) error = `unknown tool ${call.function.name}`;
      if (args && !error) {
        try {
          const answer = await options.callTool(call.function.name, args);
          ok = !answer.isError;
          if (answer.isError) error = clip(answer.text, 300);
          text = answer.text;
        } catch (callError) {
          error = callError instanceof Error ? callError.message : String(callError);
          text = `Error: ${error}`;
        }
      } else {
        text = `Error: ${error}`;
      }
      result.toolCalls.push({
        turn,
        name: call.function.name,
        arguments: clip(call.function.arguments, 400),
        ok,
        error,
        ms: now() - began,
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: clip(text!, options.maxResultChars ?? 6000),
      });
    }
  }
  result.durationMs = now() - started;
  return result;
}
