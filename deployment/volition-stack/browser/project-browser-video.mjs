// The live view as video: ffmpeg grabs the page area of the browser window from the project's
// X display and encodes it as H.264 in fragmented MP4, one fragment per frame. A viewer plays
// the fragments with Media Source Extensions, or decodes them with WebCodecs where the page is
// a secure context.
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const FRAME_RATE = 60;
// A keyframe every two seconds: a viewer that joins or falls behind waits at most that long.
const KEYFRAME_INTERVAL = FRAME_RATE * 2;
const QUALITY_CRF = 18;
const XRANDR_TIMEOUT_MS = 5_000;

// The ffmpeg arguments for grabbing an area of a display at 60 frames a second and encoding
// it with the least delay: no B-frames and no lookahead, and a fragment written per frame.
export function encoderArguments({ display, x, y, width, height }) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "x11grab",
    "-draw_mouse",
    "0",
    "-framerate",
    String(FRAME_RATE),
    "-video_size",
    `${width}x${height}`,
    "-i",
    `:${display}+${x},${y}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    String(QUALITY_CRF),
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(KEYFRAME_INTERVAL),
    "-f",
    "mp4",
    "-movflags",
    "empty_moov+default_base_moof+frag_every_frame",
    "-flush_packets",
    "1",
    "-",
  ];
}

// The complete top-level MP4 boxes at the start of a buffer, and the bytes after them.
export function readBoxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const size = buffer.readUInt32BE(offset);
    if (size < 8) throw new Error("Unsupported MP4 box");
    if (buffer.length - offset < size) break;
    boxes.push({ type: buffer.toString("latin1", offset + 4, offset + 8), data: buffer.subarray(offset, offset + size) });
    offset += size;
  }
  return { boxes, rest: buffer.subarray(offset) };
}

// The codec string of the H.264 stream an initialization segment describes, from the profile,
// compatibility and level bytes of its avcC box.
export function codecOf(init) {
  const at = init.indexOf("avcC", 0, "latin1");
  if (at < 0) throw new Error("No H.264 configuration");
  return `avc1.${init.subarray(at + 5, at + 8).toString("hex")}`;
}

// Whether a fragment's sample holds an IDR picture, which a decoder can start from. The mdat
// payload is the sample: NAL units, each after its length in four bytes.
export function isKeyframe(mdat) {
  for (let offset = 8; offset + 5 <= mdat.length; ) {
    const length = mdat.readUInt32BE(offset);
    if ((mdat[offset + 4] & 0x1f) === 5) return true;
    offset += 4 + length;
  }
  return false;
}

// The display's current and largest framebuffer size, from `xrandr --current`.
export function screenSizes(xrandrOutput) {
  const match = /current (\d+) x (\d+), maximum (\d+) x (\d+)/.exec(xrandrOutput);
  if (!match) return null;
  const [, width, height, maxWidth, maxHeight] = match.map(Number);
  return { width, height, maxWidth, maxHeight };
}

function xrandr(environment, args) {
  return new Promise((resolve, reject) => {
    execFile("xrandr", args, { env: environment, timeout: XRANDR_TIMEOUT_MS }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

// Grows the display to hold an area from its top left corner; ffmpeg can grab only what is on
// the screen. Resolves false when the display cannot be that large.
export async function fitScreen(environment, width, height) {
  const sizes = screenSizes(await xrandr(environment, ["--current"]));
  if (!sizes) return false;
  if (sizes.width >= width && sizes.height >= height) return true;
  const target = { width: Math.max(sizes.width, width), height: Math.max(sizes.height, height) };
  if (target.width > sizes.maxWidth || target.height > sizes.maxHeight) return false;
  await xrandr(environment, ["--fb", `${target.width}x${target.height}`]);
  return true;
}

// One ffmpeg process for an area of a display. Emits "init" with the initialization segment
// and its codec string, "fragment" with each frame's fragment and whether it is a keyframe,
// and "exit" when ffmpeg ends.
export class AreaEncoder extends EventEmitter {
  constructor({ display, xauthority, x, y, width, height }) {
    super();
    this.environment = { PATH: process.env.PATH, DISPLAY: `:${display}`, XAUTHORITY: xauthority };
    this.area = { display, x, y, width, height };
    this.process = null;
    this.buffer = Buffer.alloc(0);
    this.init = [];
    this.moof = null;
    this.stopped = false;
  }

  async start() {
    const onScreen = await fitScreen(this.environment, this.area.x + this.area.width, this.area.y + this.area.height);
    if (!onScreen) throw new Error("The display cannot hold the page");
    if (this.stopped) return;
    this.process = spawn("ffmpeg", encoderArguments(this.area), {
      env: this.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process.stdout.on("data", (chunk) => this.read(chunk));
    this.process.stderr.resume();
    this.process.on("error", () => {});
    this.process.on("exit", (code) => this.emit("exit", this.stopped ? null : code));
  }

  read(chunk) {
    const { boxes, rest } = readBoxes(this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk);
    this.buffer = rest;
    for (const { type, data } of boxes) {
      if (type === "ftyp") this.init = [data];
      else if (type === "moov") {
        const init = Buffer.concat([...this.init, data]);
        this.emit("init", init, codecOf(init));
      } else if (type === "moof") this.moof = data;
      else if (type === "mdat" && this.moof) {
        this.emit("fragment", Buffer.concat([this.moof, data]), isKeyframe(data));
        this.moof = null;
      }
    }
  }

  stop() {
    this.stopped = true;
    this.process?.kill("SIGKILL");
  }
}
