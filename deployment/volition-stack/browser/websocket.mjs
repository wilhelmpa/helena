// The server side of WebSocket for the live view: the `ws` library (RFC 6455 framing,
// fragmentation, UTF-8 validation, close handshake, ping/pong, backpressure), which the
// router resolves from its workspace package (package.json next to this file). Only the
// heartbeat is ours: `ws` answers pings but never sends one.
import { WebSocketServer } from "ws";

const MAX_MESSAGE = 256 * 1024;
// A peer that sends nothing, not even the answer to a ping, for this long is gone.
const HEARTBEAT_MS = 30_000;

// noServer: the router's own HTTP server hands over each upgrade it has checked (project,
// origin). No compression: the frames are video and JPEG.
const server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });

function keepAlive(connection) {
  let heard = true;
  const hear = () => {
    heard = true;
  };
  connection.on("message", hear);
  connection.on("ping", hear);
  connection.on("pong", hear);
  const heartbeat = setInterval(() => {
    if (!heard) return connection.terminate();
    heard = false;
    connection.ping();
  }, HEARTBEAT_MS);
  heartbeat.unref();
  connection.on("close", () => clearInterval(heartbeat));
}

// Completes the handshake of an upgrade request and passes the connection on: a `ws`
// WebSocket, which emits "message" (Buffer, isBinary) and "close", and has send(),
// close(code, reason) and bufferedAmount. A request that is no WebSocket handshake is
// answered 400 and never reaches onConnection.
export function acceptWebSocket(request, socket, head, onConnection) {
  server.handleUpgrade(request, socket, head, (connection) => {
    // A protocol error (an unmasked frame, bad UTF-8, a message over the limit) closes the
    // connection with its code; `ws` reports it as an error event, which needs a listener
    // or it would end the router.
    connection.on("error", () => {});
    keepAlive(connection);
    onConnection(connection);
  });
}
