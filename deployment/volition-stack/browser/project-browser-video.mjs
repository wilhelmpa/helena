// The live view as video: ffmpeg grabs the page area of the browser window from the project's
// X display and encodes it as H.264 in fragmented MP4, one fragment per frame. A viewer plays
// the fragments with Media Source Extensions, or decodes them with WebCodecs where the page is
// a secure context.
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const XRANDR_TIMEOUT_MS = 5_000;

// Quality tiers, from the one a wired LAN affords down to the one a slow, lossy connection
// still plays smoothly. A viewer is put on the best tier its measured connection (chooseTier)
// affords, and viewers on the same tier of the same stream share one encoder: at most one
// ffmpeg per tier, never one per viewer. `scaleMax` bounds the encoded frame's long edge, so a
// low tier also costs less to encode and to decode; `threads` bounds a tier's own CPU use.
// Every tier keeps a keyframe close enough that a viewer who joins mid-stream, or one recovering
// from a stall, is never far from one: the encoder cannot be told to force one out of turn, so
// a short, fixed interval stands in for that (see AreaEncoder and the README).
export const TIERS = [
  { name: "high", scaleMax: null, frameRate: 60, crf: 18, keyframeSeconds: 2, threads: 4 },
  { name: "medium", scaleMax: 1280, frameRate: 30, crf: 24, keyframeSeconds: 1.5, threads: 2 },
  { name: "low", scaleMax: 854, frameRate: 18, crf: 30, keyframeSeconds: 1, threads: 1 },
];

// The round trip a tier needs to be worth trying (see chooseTier). Node's own bufferedAmount
// is bytes not yet handed to the kernel; on a real network, or one shaped for a bench, a
// socket can be badly backed up well before that number moves, because the kernel and the
// network path both buffer far more than Node ever sees. A backlog past CONGESTED_BYTES still
// means the worst tier at once when it does show — sized to a fraction of a second of the
// busiest tier, not the many megabytes a perfectly healthy stream can briefly hold — but it is
// a safety net, not the primary signal.
const RTT_MS = { high: 60, medium: 250, low: Infinity };
const CONGESTED_BYTES = 384 * 1024;
// Below this, the tier's own encoder is producing too little — a quiet page — for its bitrate
// against what the viewer reports receiving to say anything about the connection.
const MEANINGFUL_ENCODE_KBPS = 150;
// A connection genuinely struggling receives well under what its own tier is sending it: this
// ratio, not a fixed table, is what argues for dropping on throughput grounds, because a lower
// tier's own bitrate is never proof a better one is out of reach — only a shortfall against
// what is actually being asked of the connection right now is.
const SHORTFALL_RATIO = 0.6;
// A viewer whose last stats report is older than this, despite being on a video tier, is
// assumed congested: the report that would say so travels the same connection as the video
// and can itself be stuck behind the backlog it would describe.
const FEEDBACK_TIMEOUT_MS = 8_000;

// The tier a viewer's connection affords, given its last measurement and the tier index it is
// on now (null for a viewer joining fresh, which starts on a safe middle tier before its
// first real measurement arrives, rather than reading its unmeasured zeros as either extreme).
// A tier drops as far as the numbers call for right away, so a stall recovers quickly, but
// rises only one step at a time, so a connection that looks better for one sample does not
// swing the picture straight to the heaviest tier.
//
// The round trip alone sets the ceiling for rising: a live H.264 stream's own bitrate swings
// hugely with how much the page is changing, so the tier a viewer is already on is never proof
// a better one is unaffordable, and only trying it can tell. A genuine shortfall — reported
// downlink well under what the current tier is actually sending — argues for dropping instead,
// on the same terms a stall does: it is evidence the connection cannot keep up with the demand
// actually being placed on it right now, not with some fixed idea of what a tier "needs".
export function chooseTier(measurement, currentIndex = null) {
  if (currentIndex === null || currentIndex === undefined) {
    return TIERS.findIndex((tier) => tier.name === "medium");
  }
  const { downlinkKbps = 0, rttMs = 0, bufferedBytes = 0, encodedKbps = 0, feedbackAgeMs = 0 } = measurement;
  const strained = encodedKbps > MEANINGFUL_ENCODE_KBPS && downlinkKbps < encodedKbps * SHORTFALL_RATIO;
  if (bufferedBytes > CONGESTED_BYTES || feedbackAgeMs > FEEDBACK_TIMEOUT_MS || strained) {
    return TIERS.length - 1;
  }
  let affordable = TIERS.length - 1;
  for (let index = 0; index < TIERS.length; index++) {
    if (rttMs <= RTT_MS[TIERS[index].name]) {
      affordable = index;
      break;
    }
  }
  // A lower index is a better tier. Dropping to a worse or equal one (a higher or same index)
  // applies at once; rising to a better one (a lower index) moves at most one step closer.
  if (affordable >= currentIndex) return affordable;
  return Math.max(affordable, currentIndex - 1);
}

// A size scaled down to at most maxEdge on its long side, kept even for yuv420p, or the size
// itself when it already fits or the tier keeps the capture size (maxEdge is null).
export function scaledSize(width, height, maxEdge) {
  if (!maxEdge || Math.max(width, height) <= maxEdge) return { width, height };
  const factor = maxEdge / Math.max(width, height);
  const even = (value) => Math.max(2, Math.round((value * factor) / 2) * 2);
  return { width: even(width), height: even(height) };
}

// Whether two capture areas are the same, so an encoder already running for them is reused.
export function sameArea(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

// The ffmpeg arguments for grabbing an area of a display and encoding it at a tier's frame
// rate, quality and thread limit, with the least delay: no B-frames and no lookahead, and a
// fragment written per frame. The tier's keyframe interval bounds how long a viewer who joins
// mid-stream, or misses frames to a stall, waits for the next one.
export function encoderArguments({ x, y, width, height, display }, tier) {
  const size = scaledSize(width, height, tier.scaleMax);
  const scale = size.width === width && size.height === height ? [] : ["-vf", `scale=${size.width}:${size.height}`];
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
    String(tier.frameRate),
    "-video_size",
    `${width}x${height}`,
    "-i",
    `:${display}+${x},${y}`,
    ...scale,
    "-c:v",
    "libx264",
    "-threads",
    String(tier.threads),
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    String(tier.crf),
    "-bf",
    "0",
    // Multiple threads default to x264's frame-parallel mode, which pipelines several frames
    // at once and so holds each one back a few frames before it comes out the other end.
    // Slice-parallel mode instead splits each frame across the threads, which has no such
    // queue: more than one thread costs nothing in latency, only in the bitstream's own
    // slice overhead.
    "-x264-params",
    "sliced-threads=1:rc-lookahead=0:sync-lookahead=0",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(Math.max(1, Math.round(tier.frameRate * tier.keyframeSeconds))),
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
  constructor({ display, xauthority, x, y, width, height, tier = TIERS[0] }) {
    super();
    this.environment = { PATH: process.env.PATH, DISPLAY: `:${display}`, XAUTHORITY: xauthority };
    this.area = { display, x, y, width, height };
    this.tier = tier;
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
    this.process = spawn("ffmpeg", encoderArguments(this.area, this.tier), {
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
