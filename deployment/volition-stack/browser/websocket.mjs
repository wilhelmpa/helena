// The server side of RFC 6455 for the live view. The router is installed as plain files
// without dependencies, and Node ships a WebSocket client only.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 256 * 1024;
// A peer that sends nothing, not even the answer to a ping, for this long is gone.
const HEARTBEAT_MS = 30_000;
// How long a peer has to answer a close before the connection is dropped.
const CLOSE_TIMEOUT_MS = 5_000;

const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 0x10000) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

// One accepted connection. Emits "message" (Buffer, isBinary) and "close".
export class WebSocketConnection extends EventEmitter {
  constructor(socket, head = Buffer.alloc(0)) {
    super();
    this.socket = socket;
    // Received bytes are joined once they hold the next frame, not on every chunk.
    this.chunks = head.length ? [head] : [];
    this.received = head.length;
    this.needed = 2;
    this.fragments = [];
    this.fragmentsLength = 0;
    this.binary = false;
    this.closed = false;
    this.heard = true;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      this.heard = true;
      this.chunks.push(chunk);
      this.received += chunk.length;
      if (this.received >= this.needed) this.read();
    });
    // A peer that ends the connection without a close frame; Node leaves an upgraded
    // socket half open.
    socket.on("end", () => socket.destroy());
    socket.on("close", () => this.finish());
    socket.on("error", () => socket.destroy());
    this.heartbeat = setInterval(() => {
      if (!this.heard) return socket.destroy();
      this.heard = false;
      socket.write(encodeFrame(PING, Buffer.alloc(0)));
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
    if (this.received >= this.needed) queueMicrotask(() => this.read());
  }

  // Bytes accepted by send() that the socket has not written yet.
  get bufferedAmount() {
    return this.socket.writableLength;
  }

  send(data) {
    if (this.closed) return;
    const binary = Buffer.isBuffer(data);
    this.socket.write(encodeFrame(binary ? BINARY : TEXT, binary ? data : Buffer.from(data)));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.socket.end(encodeFrame(CLOSE, payload));
    setTimeout(() => this.socket.destroy(), CLOSE_TIMEOUT_MS).unref();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.emit("close");
  }

  read() {
    let buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    while (!this.closed) {
      this.needed = 2;
      if (buffer.length < 2) break;
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const fin = (first & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        this.needed = 4;
        if (buffer.length < 4) break;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        this.needed = 10;
        if (buffer.length < 10) break;
        const long = buffer.readBigUInt64BE(2);
        if (long > BigInt(MAX_MESSAGE)) return this.close(1009, "Message too large");
        length = Number(long);
        offset = 10;
      }
      // Browsers mask every frame they send; RFC 6455 requires closing on one that is not.
      if ((second & 0x80) === 0) return this.close(1002, "Unmasked frame");
      if (length > MAX_MESSAGE) return this.close(1009, "Message too large");
      this.needed = offset + 4 + length;
      if (buffer.length < this.needed) break;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
      buffer = buffer.subarray(offset + 4 + length);
      this.handle(opcode, fin, payload);
    }
    this.chunks = buffer.length ? [buffer] : [];
    this.received = buffer.length;
  }

  handle(opcode, fin, payload) {
    if (opcode >= CLOSE) {
      if (!fin || payload.length > 125) return this.close(1002, "Invalid control frame");
      if (opcode === CLOSE) return this.close(1000);
      if (opcode === PING) this.socket.write(encodeFrame(PONG, payload));
      return;
    }
    const continuation = opcode === 0;
    if (continuation !== this.fragments.length > 0 || (!continuation && opcode !== TEXT && opcode !== BINARY)) {
      return this.close(1002, "Unexpected frame");
    }
    if (!continuation) this.binary = opcode === BINARY;
    this.fragmentsLength += payload.length;
    if (this.fragmentsLength > MAX_MESSAGE) return this.close(1009, "Message too large");
    this.fragments.push(payload);
    if (!fin) return;
    const message = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentsLength = 0;
    this.emit("message", message, this.binary);
  }
}

// Completes the handshake of an upgrade request, or refuses one that is no WebSocket
// handshake and returns null.
export function acceptWebSocket(request, socket, head) {
  const key = request.headers["sec-websocket-key"];
  if (
    String(request.headers.upgrade).toLowerCase() !== "websocket" ||
    typeof key !== "string" ||
    request.headers["sec-websocket-version"] !== "13"
  ) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const accept = crypto.createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WebSocketConnection(socket, head);
}
