// The wire protocol between the stdio MCP shim (shim.ts) and the browser gateway's Unix
// socket (deployment/volition-stack/browser/browser-gateway-server.mjs). Kept apart from the
// MCP SDK so it is testable on its own.
//
//   connect fresh per call to the socket
//   write one line of JSON + "\n":
//     {"tool", "args", "agentKey", "runId"?, "messageId"?,
//      "uploads"?: [{"name","mimeType","data"}, …]}
//   read one line of JSON back:
//     {"ok": true, "content": "<text>", "image"?: {"data","mimeType"}} | {"ok": false, "error"}
//
// The shim runs as the agent, inside its sandbox: it has no rights of its own and adds only
// what the agent itself has — its key from the environment and, for browser_file_upload,
// the bytes of the files the agent can read.
import { readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

// Where the isolation launcher binds the project's gateway directory in an agent unit.
export const DEFAULT_SOCKET_PATH = '/run/volition-agents/browser/gateway.sock';
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export type ShimEnv = Record<string, string | undefined>;

export interface CallToolResult {
  [key: string]: unknown;
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError: boolean;
}

// A value Hermes left as its literal "${NAME}" placeholder (the variable was not set) counts
// as not set.
function envValue(env: ShimEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && !value.startsWith('${') ? value : undefined;
}

function numberEnv(env: ShimEnv, name: string): number | undefined {
  const value = envValue(env, name);
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

export function socketPathFrom(env: ShimEnv): string {
  return envValue(env, 'BROWSER_GATEWAY_SOCKET') ?? DEFAULT_SOCKET_PATH;
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
};

export function mimeTypeOf(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export class ShimError extends Error {}

// What the shim sends for a call. browser_file_upload's `paths` are read here, with the
// agent's own rights, and replaced by the files' bytes: the gateway never opens a path an
// agent names. No paths cancels the open file chooser.
export async function gatewayRequest(
  toolName: string,
  args: Record<string, unknown> | undefined,
  env: ShimEnv,
  cwd: string = process.cwd(),
): Promise<Record<string, unknown>> {
  const callArgs = { ...(args ?? {}) };
  const request: Record<string, unknown> = {
    tool: toolName,
    args: callArgs,
    agentKey: envValue(env, 'ITSAPLAN_API_KEY') ?? '',
  };
  const runId = numberEnv(env, 'ITSAPLAN_RUN_ID');
  if (runId !== undefined) request.runId = runId;
  // The runner's name for a chat answer's message id (packages/runner/src/chat.ts).
  const messageId = numberEnv(env, 'ITSAPLAN_MESSAGE_ID');
  if (messageId !== undefined) request.messageId = messageId;
  if (toolName === 'browser_file_upload') {
    const given = callArgs.paths;
    delete callArgs.paths;
    const paths = typeof given === 'string' ? [given] : Array.isArray(given) ? given : [];
    if (paths.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new ShimError('paths must be a list of file paths.');
    }
    if (paths.length > MAX_UPLOAD_FILES) {
      throw new ShimError(`At most ${MAX_UPLOAD_FILES} files at once.`);
    }
    const uploads = [];
    let total = 0;
    for (const entry of paths as string[]) {
      const file = path.resolve(cwd, entry);
      let info;
      try {
        info = await stat(file);
      } catch {
        throw new ShimError(`Cannot read ${entry}: it does not exist or is not yours to read.`);
      }
      if (!info.isFile()) throw new ShimError(`${entry} is not a file.`);
      total += info.size;
      if (total > MAX_UPLOAD_BYTES)
        throw new ShimError('The files are larger than 50 MB together.');
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        throw new ShimError(`Cannot read ${entry}.`);
      }
      uploads.push({
        name: path.basename(file),
        mimeType: mimeTypeOf(file),
        data: bytes.toString('base64'),
      });
    }
    request.uploads = uploads;
  }
  return request;
}

function textResult(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

// Maps the gateway's answer to the MCP CallToolResult shape. A screenshot comes back as an
// image block the model sees as a picture, next to its text.
export function toolResult(response: unknown): CallToolResult {
  const answer = response as {
    ok?: unknown;
    content?: unknown;
    error?: unknown;
    image?: { data?: unknown; mimeType?: unknown };
  } | null;
  if (answer && answer.ok === true && typeof answer.content === 'string') {
    const image = answer.image;
    if (image && typeof image.data === 'string' && typeof image.mimeType === 'string') {
      return {
        content: [
          { type: 'image', data: image.data, mimeType: image.mimeType },
          { type: 'text', text: answer.content },
        ],
        isError: false,
      };
    }
    return textResult(answer.content, false);
  }
  if (answer && answer.ok === false) {
    return textResult(String(answer.error ?? 'The browser gateway refused the call.'), true);
  }
  return textResult('The browser gateway answered something unreadable.', true);
}

// One JSON line out, one JSON line back, over a fresh connection (the shape of every exchange).
function exchange(socketPath: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const socket = net.createConnection(socketPath);
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const part = newline === -1 ? chunk : chunk.subarray(0, newline);
      size += part.length;
      if (size > MAX_RESPONSE_BYTES) return finish(new Error('answer too large'));
      chunks.push(part);
      if (newline === -1) return;
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(new Error('unreadable answer'));
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => finish(new Error('closed without an answer')));
  });
}

// The names of the tools the gateway offers this agent (docs/helena-decisions/browser-task.md
// §3.2): browser_task, browser_check and browser_choose only where the project has a decision
// model. Null when the gateway does not answer (an older gateway, none running): the caller then
// lists the step tools.
export async function listGatewayTools(
  options: { env?: ShimEnv; socketPath?: string } = {},
): Promise<string[] | null> {
  const env = options.env ?? process.env;
  try {
    const answer = (await exchange(options.socketPath ?? socketPathFrom(env), {
      list: true,
      agentKey: envValue(env, 'ITSAPLAN_API_KEY') ?? '',
    })) as { ok?: unknown; tools?: unknown } | null;
    if (
      answer?.ok === true &&
      Array.isArray(answer.tools) &&
      answer.tools.every((t) => typeof t === 'string')
    ) {
      return answer.tools as string[];
    }
    return null;
  } catch {
    return null;
  }
}

// Connects fresh, sends one call, reads one line back. Never throws: a connection error (the
// gateway is not running, or this agent has none) or an unreadable answer comes back as a
// normal tool error the model can read.
export async function callGateway(
  toolName: string,
  args: Record<string, unknown> | undefined,
  options: { env?: ShimEnv; socketPath?: string; cwd?: string } = {},
): Promise<CallToolResult> {
  const env = options.env ?? process.env;
  const socketPath = options.socketPath ?? socketPathFrom(env);
  let request: Record<string, unknown>;
  try {
    request = await gatewayRequest(toolName, args, env, options.cwd);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let size = 0;
    const socket = net.createConnection(socketPath);
    const finish = (result: CallToolResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const part = newline === -1 ? chunk : chunk.subarray(0, newline);
      size += part.length;
      if (size > MAX_RESPONSE_BYTES) {
        finish(textResult('The browser gateway answered too much.', true));
        return;
      }
      chunks.push(part);
      if (newline === -1) return;
      let response: unknown;
      try {
        response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        finish(textResult('The browser gateway answered something unreadable.', true));
        return;
      }
      finish(toolResult(response));
    });

    socket.on('error', (error) => {
      // Without isolation the runner passes the project's socket; an agent without it was
      // started before its runner config knew the gateway.
      const hint =
        envValue(env, 'BROWSER_GATEWAY_SOCKET') === undefined && !options.socketPath
          ? ' The runner gave this agent no BROWSER_GATEWAY_SOCKET: restart volition-hermes-runner once its catalog script is current.'
          : '';
      finish(
        textResult(
          `Cannot reach the project browser (${error.message}). The browser gateway is not running, or this agent has no project browser.${hint}`,
          true,
        ),
      );
    });

    socket.on('close', () => {
      finish(textResult('The browser gateway closed the connection without answering.', true));
    });
  });
}
