// The frozen wire protocol between the stdio MCP shim (browser-gateway-mcp-shim.mjs) and the
// browser gateway's Unix socket (design volition-design-browser-gateway.md §3). Kept in its
// own module, with no dependency beyond node:net, so it is testable without the MCP SDK
// installed -- see browser-gateway-mcp-shim.mjs for how the two are wired together.
//
// Wire protocol (do not change without changing the gateway server the same way):
//   connect fresh (net.createConnection) per call to the socket path
//   write one line of JSON + "\n":
//     {"tool": "<name>", "args": {...}, "agentKey": "<...>", "runId": <number,omittable>,
//      "messageId": <number,omittable>}
//   read one line of JSON back:
//     {"ok": true, "content": "<text>"} | {"ok": false, "error": "<text>"}
import net from "node:net";

export const DEFAULT_SOCKET_PATH = "/run/volition-agents/browser.sock";

function numberEnv(value) {
  return value !== undefined && /^-?\d+$/.test(value) ? Number(value) : undefined;
}

// Exported for the test: what the shim would send on the wire for a call, from a given
// environment (defaults to process.env, but the test passes its own so it never depends on
// how it happens to be invoked).
export function gatewayRequestLine(toolName, args, env = process.env) {
  const request = { tool: toolName, args: args ?? {}, agentKey: env.ITSAPLAN_API_KEY ?? "" };
  const runId = numberEnv(env.ITSAPLAN_RUN_ID);
  if (runId !== undefined) request.runId = runId;
  // ITSAPLAN_MESSAGE_ID is the runner's existing convention for a chat answer's message id
  // (packages/runner/src/chat.ts) -- there is no separate "ITSAPLAN_CHAT_MESSAGE_ID".
  const messageId = numberEnv(env.ITSAPLAN_MESSAGE_ID);
  if (messageId !== undefined) request.messageId = messageId;
  return `${JSON.stringify(request)}\n`;
}

function textResult(text, isError) {
  return { content: [{ type: "text", text }], isError };
}

// Connects fresh, sends one call, reads one line back, and maps it to the MCP SDK's
// CallToolResult shape. Never throws: a connection error (the socket is not present, e.g.
// outside a sandboxed unit) or an unreadable answer comes back as a normal tool error.
export function callGateway(toolName, args, options = {}) {
  const env = options.env ?? process.env;
  const socketPath = options.socketPath ?? (env.BROWSER_GATEWAY_SOCKET || DEFAULT_SOCKET_PATH);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection(socketPath);
    let buffer = "";

    socket.on("connect", () => {
      socket.write(gatewayRequestLine(toolName, args, env));
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        finish(textResult("The browser gateway answered something unreadable.", true));
        return;
      }
      if (response && response.ok === true && typeof response.content === "string") {
        finish(textResult(response.content, false));
      } else if (response && response.ok === false) {
        finish(textResult(String(response.error ?? "The browser gateway refused the call."), true));
      } else {
        finish(textResult("The browser gateway answered something unreadable.", true));
      }
    });

    socket.on("error", (error) => {
      finish(textResult(`Cannot reach the browser gateway (${socketPath}): ${error.message}`, true));
    });

    socket.on("close", () => {
      finish(textResult("The browser gateway closed the connection without answering.", true));
    });
  });
}
