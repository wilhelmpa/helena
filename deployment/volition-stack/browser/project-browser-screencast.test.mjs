import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { InputSender, viewerMessage } from "./project-browser-input.mjs";
import { captureArea, frameMessage, pageSize, targetSize, videoAllowance } from "./project-browser-screencast.mjs";
import { acceptWebSocket } from "./websocket.mjs";

const input = (message) => viewerMessage(JSON.stringify(message));

describe("live view messages", () => {
  it("reads the view's CSS size and pixel ratio", () => {
    assert.deepEqual(input({ type: "viewport", width: 812.4, height: 600.6, dpr: 2 }), {
      viewport: { width: 812, height: 601, dpr: 2, video: false, hold: false },
    });
    assert.deepEqual(input({ type: "viewport", width: 1280, height: 700, dpr: 1.3333333, video: true, hold: true }), {
      viewport: { width: 1280, height: 700, dpr: 1.333, video: true, hold: true },
    });
    assert.deepEqual(input({ type: "viewport", width: 50, height: 9000 }), {
      viewport: { width: 100, height: 8192, dpr: 1, video: false, hold: false },
    });
    assert.deepEqual(input({ type: "ack" }), { ack: true });
    assert.deepEqual(input({ type: "dialog", accept: false }), { dialog: { accept: false } });
    assert.deepEqual(input({ type: "dialog", accept: true, text: "answer" }), {
      dialog: { accept: true, promptText: "answer" },
    });
    assert.deepEqual(input({ type: "hidden", hidden: true }), { hidden: true });
    assert.deepEqual(input({ type: "stats", rttMs: 42, downlinkKbps: 3500, receivedBytes: 4_000_000 }), {
      stats: { rttMs: 42, downlinkKbps: 3500, receivedBytes: 4_000_000 },
    });
    assert.deepEqual(input({ type: "stats" }), { stats: { rttMs: 0, downlinkKbps: 0, receivedBytes: 0 } });
    assert.deepEqual(input({ type: "requestKeyframe" }), { requestKeyframe: true });
    assert.deepEqual(input({ type: "focus" }), { focus: true });
    assert.deepEqual(input({ type: "ping", t: 123.5 }), { ping: 123.5 });
  });

  it("sends frames at ratio 2 to a high-density screen, small pages too unless an agent is in the browser", () => {
    const size = (width, height, ratio, pin1 = false) => ({ width, height, ratio, pin1 });
    assert.deepEqual(pageSize({ width: 800, height: 900, dpr: 2 }), size(800, 900, 2));
    assert.deepEqual(pageSize({ width: 1200, height: 700, dpr: 1.5 }), size(1200, 700, 2));
    assert.deepEqual(pageSize({ width: 1200, height: 700, dpr: 3 }), size(1200, 700, 2));
    assert.deepEqual(pageSize({ width: 1200, height: 700, dpr: 1.25 }), size(1200, 700, 1));
    // A narrow tool panel on a retina screen is as sharp as a wide one while no agent works in
    // the browser (the owner's report: 619x612 fell to ratio 1 and looked blurred).
    assert.deepEqual(pageSize({ width: 619, height: 612, dpr: 2 }), size(619, 612, 2));
    // With an agent in the browser, a 2x screenshot of a page with a long edge under 785 CSS
    // pixels would reach it at twice the size its clicks use: the page is drawn at ratio 1.
    assert.deepEqual(pageSize({ width: 620, height: 780, dpr: 2 }, true), size(620, 780, 1, true));
    assert.deepEqual(pageSize({ width: 620, height: 780, dpr: 1 }, true), size(620, 780, 1, true));
    assert.deepEqual(pageSize({ width: 800, height: 900, dpr: 2 }, true), size(800, 900, 2));
    // A browser that draws at factor 1 has nothing sharper to send, nor to pin.
    assert.deepEqual(pageSize({ width: 800, height: 900, dpr: 2 }, false, 1), size(800, 900, 1));
    assert.deepEqual(pageSize({ width: 620, height: 780, dpr: 2 }, true, 1), size(620, 780, 1));
    // A phone's narrow view keeps its width: the window keeper pins the page at it inside the
    // narrowest window Chromium allows.
    assert.deepEqual(pageSize({ width: 390, height: 700, dpr: 3 }), size(390, 700, 2));
    assert.deepEqual(pageSize({ width: 360, height: 640, dpr: 1 }, false, 1), size(360, 640, 1));
    // At ratio 1 an odd size is made even, one pixel larger, so the video's frame is the page
    // to the pixel; the view cuts that pixel off.
    assert.deepEqual(pageSize({ width: 933, height: 601, dpr: 1 }), size(934, 602, 1));
    assert.deepEqual(pageSize({ width: 933, height: 601, dpr: 2 }), size(933, 601, 2));
  });

  it("keeps the page's CSS size while the agent acts, at a ratio its screenshots allow", () => {
    const view = { width: 900, height: 900, dpr: 2 };
    const current = { width: 800, height: 900, ratio: 2, pin1: false };
    assert.deepEqual(targetSize(view, current, false), { width: 900, height: 900, ratio: 2, pin1: false });
    // A JPEG stream drops to ratio 1, video keeps ratio 2 where the agent can click from it.
    assert.deepEqual(targetSize(view, current, true), { ...current, ratio: 1 });
    assert.deepEqual(targetSize(view, current, true, true), current);
    // A small page drawn at ratio 2 before the agent came is drawn at ratio 1, keeping its layout.
    const small = { width: 619, height: 612, ratio: 2, pin1: false };
    assert.deepEqual(targetSize(view, small, true, true), { ...small, ratio: 1, pin1: true });
    // An agent in the browser that is not acting yet: the view's size, safe for it.
    assert.deepEqual(targetSize({ width: 619, height: 612, dpr: 2 }, small, false, true, true), {
      width: 620,
      height: 612,
      ratio: 1,
      pin1: true,
    });
    // Before a live view sized the page, the agent keeps the size it has.
    assert.equal(targetSize(view, null, true), null);
  });

  it("grabs the page in display pixels and encodes it at the frames' ratio", () => {
    const chrome = { width: 0, height: 87, scale: 2 };
    assert.deepEqual(captureArea({ width: 619, height: 612, ratio: 2 }, chrome), {
      x: 0,
      y: 174,
      width: 1238,
      height: 1224,
      outWidth: 1238,
      outHeight: 1224,
    });
    assert.deepEqual(captureArea({ width: 620, height: 612, ratio: 1 }, chrome), {
      x: 0,
      y: 174,
      width: 1240,
      height: 1224,
      outWidth: 620,
      outHeight: 612,
    });
    // A browser at factor 1 has no more pixels than the page's CSS size.
    assert.deepEqual(captureArea({ width: 800, height: 600, ratio: 2 }, { ...chrome, scale: 1 }), {
      x: 0,
      y: 87,
      width: 800,
      height: 600,
      outWidth: 800,
      outHeight: 600,
    });
  });

  it("lets a video viewer fall behind by two keyframes and a stats report's worth of frames", () => {
    // Never less than half a megabyte, as before.
    assert.equal(videoAllowance({}), 512 * 1024);
    assert.equal(videoAllowance({ keyframeBytes: 100_000, encodedKbps: 1_000, rttMs: 20 }), 512 * 1024);
    // A 1.5 MB keyframe at pixel ratio 2, 20 Mbit/s, 20 ms round trip: 3 MB + 800 KB.
    assert.equal(videoAllowance({ keyframeBytes: 1_500_000, encodedKbps: 20_000, rttMs: 20 }), 3_800_000);
    // A round trip counts for at most a second.
    assert.equal(
      videoAllowance({ keyframeBytes: 1_500_000, encodedKbps: 8_000, rttMs: 60_000 }),
      videoAllowance({ keyframeBytes: 1_500_000, encodedKbps: 8_000, rttMs: 1_000 }),
    );
  });

  it("sends mouse input at page coordinates with buttons and modifiers", () => {
    assert.deepEqual(
      input({ type: "mouse", event: "down", x: 10.5, y: 20, button: "left", buttons: 1, clickCount: 2, modifiers: 8 }),
      {
        commands: [
          {
            method: "Input.dispatchMouseEvent",
            params: { type: "mousePressed", x: 10.5, y: 20, modifiers: 8, button: "left", buttons: 1, clickCount: 2 },
          },
        ],
      },
    );
    assert.deepEqual(input({ type: "mouse", event: "move", x: -5, y: 3 }).commands[0].params, {
      type: "mouseMoved",
      x: 0,
      y: 3,
      modifiers: 0,
      button: "none",
      buttons: 0,
    });
    // A tap is a click: the button is held on the press and released after it.
    const click = input({ type: "mouse", event: "click", x: 1, y: 2, button: "left" }).commands;
    assert.deepEqual(
      click.map(({ params }) => [params.type, params.button, params.buttons, params.clickCount]),
      [
        ["mousePressed", "left", 1, 1],
        ["mouseReleased", "left", 0, 1],
      ],
    );
    assert.deepEqual(input({ type: "wheel", x: 5, y: 6, deltaY: 120, modifiers: 2 }).commands[0].params, {
      type: "mouseWheel",
      x: 5,
      y: 6,
      deltaX: 0,
      deltaY: 120,
      modifiers: 2,
    });
  });

  it("sends typed keys with their text and other keys without", () => {
    assert.deepEqual(input({ type: "key", event: "down", key: "a", code: "KeyA", keyCode: 65, text: "a" }), {
      commands: [
        {
          method: "Input.dispatchKeyEvent",
          params: {
            type: "keyDown",
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
            modifiers: 0,
            location: 0,
            isKeypad: false,
            autoRepeat: false,
            text: "a",
          },
        },
      ],
    });
    const backspace = input({ type: "key", event: "down", key: "Backspace", code: "Backspace", keyCode: 8 });
    assert.equal(backspace.commands[0].params.type, "rawKeyDown");
    assert.equal(backspace.commands[0].params.text, undefined);
    const shortcut = input({ type: "key", event: "up", key: "a", code: "KeyA", keyCode: 65, modifiers: 2 });
    assert.equal(shortcut.commands[0].params.type, "keyUp");
    assert.equal(shortcut.commands[0].params.modifiers, 2);
    const keypad = input({ type: "key", event: "char", key: "1", code: "Numpad1", keyCode: 97, text: "1", location: 3 });
    assert.equal(keypad.commands[0].params.type, "char");
    assert.equal(keypad.commands[0].params.isKeypad, true);
    assert.deepEqual(input({ type: "text", text: "pasted ü" }), {
      commands: [{ method: "Input.insertText", params: { text: "pasted ü" } }],
    });
  });

  it("refuses anything else", () => {
    for (const refused of [
      "not json",
      "null",
      JSON.stringify({ type: "navigate", url: "https://a.test/" }),
      JSON.stringify({ type: "mouse", event: "down", x: Number.NaN, y: 0 }),
      JSON.stringify({ type: "mouse", event: "down", x: "1", y: 0 }),
      JSON.stringify({ type: "mouse", event: "drag", x: 1, y: 0 }),
      JSON.stringify({ type: "mouse", event: "down", x: 1, y: 0, button: "thumb" }),
      JSON.stringify({ type: "mouse", event: "down", x: 1, y: 0, modifiers: 16 }),
      JSON.stringify({ type: "key", event: "down", key: "" }),
      JSON.stringify({ type: "key", event: "char", key: "a" }),
      JSON.stringify({ type: "key", event: "press", key: "a" }),
      JSON.stringify({ type: "text", text: "" }),
      JSON.stringify({ type: "text", text: "x".repeat(64 * 1024 + 1) }),
      JSON.stringify({ type: "viewport", width: "800", height: 600 }),
      JSON.stringify({ type: "viewport", width: 800, height: 600, dpr: "2" }),
      JSON.stringify({ type: "dialog", accept: "yes" }),
    ]) {
      assert.throws(() => viewerMessage(refused), /Invalid message/, refused);
    }
  });

  it("merges pointer moves and wheel turns while the page is busy, in order with clicks", async () => {
    const sent = [];
    const answers = [];
    const sender = new InputSender((method, params) => {
      sent.push(params);
      return new Promise((resolve) => answers.push(resolve));
    });
    const move = (x) => ({ method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x, y: 0 } });
    const wheel = (deltaY) => ({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 1, y: 1, deltaX: 0, deltaY },
    });
    sender.dispatch(move(1));
    sender.dispatch(move(2));
    sender.dispatch(move(3));
    sender.dispatch(wheel(10));
    sender.dispatch(wheel(20));
    sender.dispatch(wheel(30));
    assert.deepEqual(sent.map((params) => params.x ?? params.deltaY), [1, 1]);
    // A press sends the newest move and the summed wheel turns before it.
    sender.dispatch({ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 4, y: 0 } });
    assert.deepEqual(
      sent.map(({ type, x, deltaY }) => `${type}:${type === "mouseWheel" ? deltaY : x}`),
      ["mouseMoved:1", "mouseWheel:10", "mouseMoved:3", "mouseWheel:50", "mousePressed:4"],
    );
    for (const answer of answers) answer();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 5);
  });

  it("puts a kind byte and the viewport size in CSS pixels in front of each frame", () => {
    const frame = frameMessage(Buffer.from("jpeg"), { deviceWidth: 812.4, deviceHeight: 70000 }, 1);
    assert.equal(frame[0], 0); // JPEG_FRAME, so a viewer tells it apart from video messages
    assert.equal(frame.readUInt16BE(1), 812);
    assert.equal(frame.readUInt16BE(3), 0xffff);
    assert.equal(frame.subarray(5).toString(), "jpeg");
    // A page pinned narrower than its window fills the frame's left part: kind 3 names both.
    const narrow = frameMessage(Buffer.from("jpeg"), { deviceWidth: 500, deviceHeight: 700 }, 1, { width: 390, height: 700 });
    assert.deepEqual([narrow[0], ...[1, 3, 5, 7].map((at) => narrow.readUInt16BE(at))], [3, 500, 700, 390, 700]);
    assert.equal(narrow.subarray(9).toString(), "jpeg");
    assert.equal(frameMessage(Buffer.from("jpeg"), { deviceWidth: 390, deviceHeight: 700 }, 1, { width: 390, height: 700 })[0], 0);
    // The metadata is in DIP: a page 1280 DIP wide at 125 % page zoom shows 1024 CSS pixels.
    const scaled = frameMessage(Buffer.from("jpeg"), { deviceWidth: 1280, deviceHeight: 800 }, 1.25);
    assert.deepEqual([scaled.readUInt16BE(1), scaled.readUInt16BE(3)], [1024, 640]);
  });
});

let server;

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  server = null;
});

// An echo server that answers every message with the same message.
async function echoServer() {
  server = http.createServer();
  server.on("upgrade", (request, socket, head) => {
    acceptWebSocket(request, socket, head, (connection) => {
      connection.on("message", (data, binary) => connection.send(binary ? data : data.toString()));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function clientFrame(opcode, payload, { fin = true, masked = true } = {}) {
  const mask = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(payload);
  if (masked) for (let index = 0; index < body.length; index++) body[index] ^= mask[index & 3];
  const header = Buffer.from([(fin ? 0x80 : 0) | opcode, (masked ? 0x80 : 0) | body.length]);
  return Buffer.concat([header, masked ? mask : Buffer.alloc(0), body]);
}

// Opens a raw connection, completes the handshake and returns the socket with what the
// server sends after it.
async function rawClient(port) {
  const socket = net.connect(port, "127.0.0.1");
  const received = [];
  let handshake = "";
  await new Promise((resolve) => {
    socket.on("data", (chunk) => {
      if (!handshake.endsWith("\r\n\r\n")) {
        handshake += chunk.toString("latin1");
        if (handshake.endsWith("\r\n\r\n")) resolve();
      } else received.push(chunk);
    });
    socket.write(
      "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
  });
  assert.match(handshake, /^HTTP\/1\.1 101 /);
  assert.match(handshake, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
  return { socket, received: () => Buffer.concat(received) };
}

async function until(check) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check());
}

describe("WebSocket server", () => {
  it("exchanges text and binary messages of every length with a browser client", async () => {
    const port = await echoServer();
    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
    client.binaryType = "arraybuffer";
    const answers = [];
    client.addEventListener("message", (event) => answers.push(event.data));
    await new Promise((resolve) => client.addEventListener("open", resolve));
    const long = "x".repeat(70_000);
    client.send("short");
    client.send("y".repeat(300));
    client.send(long);
    client.send(new Uint8Array([1, 2, 3]));
    await until(() => answers.length === 4);
    assert.equal(answers[0], "short");
    assert.equal(answers[1], "y".repeat(300));
    assert.equal(answers[2], long);
    assert.deepEqual([...new Uint8Array(answers[3])], [1, 2, 3]);
    client.close();
  });

  it("joins fragments, answers pings and closes on an unmasked frame", async () => {
    const port = await echoServer();
    const { socket, received } = await rawClient(port);
    socket.write(clientFrame(0x1, "hel", { fin: false }));
    socket.write(clientFrame(0x9, "p"));
    socket.write(clientFrame(0x0, "lo"));
    await until(() => received().length >= 10);
    assert.deepEqual([...received()], [0x8a, 1, ...Buffer.from("p"), 0x81, 5, ...Buffer.from("hello")]);
    socket.write(clientFrame(0x1, "plain", { masked: false }));
    await until(() => received().length >= 14);
    // A close frame with code 1002 (protocol error); its reason text is the library's.
    const close = received().subarray(10);
    assert.equal(close[0], 0x88);
    assert.deepEqual([...close.subarray(2, 4)], [0x03, 0xea]);
    socket.destroy();
  });

  it("closes on a text message that is no UTF-8", async () => {
    const port = await echoServer();
    const { socket, received } = await rawClient(port);
    socket.write(clientFrame(0x1, Buffer.from([0x68, 0xff, 0x69])));
    await until(() => received().length >= 4);
    assert.equal(received()[0], 0x88);
    assert.deepEqual([...received().subarray(2, 4)], [0x03, 0xef]);
    socket.destroy();
  });

  it("reads a frame that arrives one byte at a time", async () => {
    const port = await echoServer();
    const { socket, received } = await rawClient(port);
    for (const byte of clientFrame(0x1, "slow")) socket.write(Buffer.from([byte]));
    await until(() => received().length >= 6);
    assert.deepEqual([...received()], [0x81, 4, ...Buffer.from("slow")]);
    socket.destroy();
  });

  it("closes a connection whose peer ends it without a close frame", async () => {
    let closed = false;
    server = http.createServer();
    server.on("upgrade", (request, socket, head) => {
      acceptWebSocket(request, socket, head, (connection) =>
        connection.on("close", () => {
          closed = true;
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { socket } = await rawClient(server.address().port);
    socket.end();
    await until(() => closed);
  });

  it("refuses a request that is no WebSocket handshake", async () => {
    const port = await echoServer();
    const response = await new Promise((resolve) => {
      const request = http.request({ port, host: "127.0.0.1", headers: { connection: "upgrade", upgrade: "h2c" } });
      request.on("response", resolve);
      request.end();
    });
    assert.equal(response.statusCode, 400);
  });
});
