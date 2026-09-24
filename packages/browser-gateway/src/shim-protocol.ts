// The wire protocol between the stdio MCP shim (shim.ts) and the browser gateway's Unix
// socket (deployment/volition-stack/browser/browser-gateway-server.mjs). Kept apart from the
// MCP SDK so it is testable on its own.
//
//   connect fresh per call to the socket
//   write one line of JSON + "\n":
//     {"tool", "args", "agentKey", "runId"?, "messageId"?, "upload"?: {"name","mimeType","data"}}
//   read one line of JSON back:
//     {"ok": true, "content": "<text>", "image"?: {"data","mimeType"}} | {"ok": false, "error"}
//
// The shim runs as the agent, inside its sandbox: it has no rights of its own and adds only
// what the agent itself has — its key from the environment and, for browser_upload, the
// bytes of a file the agent can read.
import { readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

// Where the isolation launcher binds the project's gateway directory in an agent unit.
export const DEFAULT_SOCKET_PATH = '/run/volition-agents/browser/gateway.sock';
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
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

// What the shim sends for a call. browser_upload's `path` is read here, with the agent's own
// rights, and replaced by the file's bytes: the gateway never opens a path an agent names.
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
  if (toolName === 'browser_upload') {
    const given = callArgs.path;
    if (typeof given !== 'string' || !given) throw new ShimError('path is required.');
    const file = path.resolve(cwd, given);
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new ShimError(`Cannot read ${given}: it does not exist or is not yours to read.`);
    }
    if (!info.isFile()) throw new ShimError(`${given} is not a file.`);
    if (info.size > MAX_UPLOAD_BYTES) throw new ShimError(`${given} is larger than 50 MB.`);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      throw new ShimError(`Cannot read ${given}.`);
    }
    delete callArgs.path;
    request.upload = {
      name: path.basename(file),
      mimeType: mimeTypeOf(file),
      data: bytes.toString('base64'),
    };
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
      finish(
        textResult(
          `Cannot reach the project browser (${error.message}). The browser gateway is not running, or this agent has no project browser.`,
          true,
        ),
      );
    });

    socket.on('close', () => {
      finish(textResult('The browser gateway closed the connection without answering.', true));
    });
  });
}
