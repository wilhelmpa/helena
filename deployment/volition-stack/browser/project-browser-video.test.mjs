import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseTier,
  codecOf,
  encoderArguments,
  isKeyframe,
  readBoxes,
  sameArea,
  scaledSize,
  screenSizes,
  TIERS,
} from "./project-browser-video.mjs";

// A top-level MP4 box: a 4-byte big-endian size, the 4-byte ASCII type, then the payload.
function box(type, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

// A length-prefixed NAL unit, as the sample data inside an mdat box carries it.
function nal(type, refIdc = 3, extra = []) {
  const length = Buffer.alloc(4);
  const unit = Buffer.from([(refIdc << 5) | type, ...extra]);
  length.writeUInt32BE(unit.length, 0);
  return Buffer.concat([length, unit]);
}

describe("quality tiers", () => {
  it("picks the best tier a fresh connection's numbers afford", () => {
    assert.equal(TIERS[chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 })].name, "high");
    assert.equal(TIERS[chooseTier({ downlinkKbps: 2000, rttMs: 40, bufferedBytes: 0 })].name, "medium");
    assert.equal(TIERS[chooseTier({ downlinkKbps: 100, rttMs: 300, bufferedBytes: 0 })].name, "low");
    // No measurement yet reads as the worst connection, so a fresh viewer starts safely.
    assert.equal(TIERS[chooseTier({ downlinkKbps: 0, rttMs: 0, bufferedBytes: 0 })].name, "low");
  });

  it("rises one tier at a time but drops as far as the numbers call for", () => {
    const lowIndex = TIERS.findIndex((tier) => tier.name === "low");
    const highIndex = TIERS.findIndex((tier) => tier.name === "high");
    // A connection now good enough for "high" only rises to "medium" from "low".
    const risen = chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 }, lowIndex);
    assert.equal(TIERS[risen].name, "medium");
    // From "medium", the same good numbers reach "high" next.
    assert.equal(chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 }, risen), highIndex);
    // A stall drops straight to the worst tier, not one step at a time.
    assert.equal(chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 3_000_000 }, highIndex), lowIndex);
    // A slow connection reported while on "high" drops straight to what it affords.
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 100, rttMs: 400, bufferedBytes: 0 }, highIndex)].name,
      "low",
    );
  });

  it("keeps the same tier when the numbers still afford it", () => {
    const mediumIndex = TIERS.findIndex((tier) => tier.name === "medium");
    assert.equal(chooseTier({ downlinkKbps: 1500, rttMs: 100, bufferedBytes: 0 }, mediumIndex), mediumIndex);
  });
});

describe("scaledSize", () => {
  it("keeps a size that already fits, or has no cap", () => {
    assert.deepEqual(scaledSize(1920, 1080, null), { width: 1920, height: 1080 });
    assert.deepEqual(scaledSize(800, 600, 1280), { width: 800, height: 600 });
  });

  it("scales the long edge down to the cap, keeping the aspect ratio and even numbers", () => {
    assert.deepEqual(scaledSize(1920, 1080, 1280), { width: 1280, height: 720 });
    // 1001 would round to an odd width; even() rounds it to the nearest even number.
    assert.deepEqual(scaledSize(2003, 1001, 1280), { width: 1280, height: 640 });
  });
});

describe("sameArea", () => {
  it("compares by position and size, not identity", () => {
    const area = { x: 0, y: 40, width: 800, height: 600 };
    assert.ok(sameArea(area, { x: 0, y: 40, width: 800, height: 600 }));
    assert.ok(!sameArea(area, { x: 0, y: 40, width: 801, height: 600 }));
    assert.ok(!sameArea(area, null));
    assert.ok(!sameArea(null, null));
  });
});

describe("encoderArguments", () => {
  it("grabs the display area at the tier's frame rate and keyframe interval", () => {
    const high = TIERS.find((tier) => tier.name === "high");
    const args = encoderArguments({ display: 87, x: 0, y: 32, width: 1280, height: 800 }, high);
    assert.ok(args.includes("x11grab"));
    assert.equal(args[args.indexOf("-video_size") + 1], "1280x800");
    assert.equal(args[args.indexOf("-i") + 1], ":87+0,32");
    assert.equal(args[args.indexOf("-framerate") + 1], String(high.frameRate));
    assert.equal(args[args.indexOf("-g") + 1], String(high.frameRate * high.keyframeSeconds));
    assert.equal(args[args.indexOf("-threads") + 1], String(high.threads));
    // The capture size already fits "high" (no cap), so no scale filter is added.
    assert.ok(!args.includes("-vf"));
  });

  it("scales a lower tier's output down and still grabs the full area", () => {
    const low = TIERS.find((tier) => tier.name === "low");
    const args = encoderArguments({ display: 87, x: 0, y: 0, width: 1920, height: 1080 }, low);
    assert.equal(args[args.indexOf("-video_size") + 1], "1920x1080");
    const scale = args[args.indexOf("-vf") + 1];
    assert.match(scale, /^scale=\d+:\d+$/);
    const [, width, height] = /^scale=(\d+):(\d+)$/.exec(scale);
    assert.ok(Math.max(Number(width), Number(height)) <= low.scaleMax);
  });
});

describe("MP4 box reading", () => {
  it("reads complete top-level boxes and keeps the trailing bytes", () => {
    const ftyp = box("ftyp", "isom");
    const moov = box("moov", "x");
    const { boxes, rest } = readBoxes(Buffer.concat([ftyp, moov, Buffer.from([1, 2, 3])]));
    assert.deepEqual(boxes.map((b) => b.type), ["ftyp", "moov"]);
    assert.deepEqual([...rest], [1, 2, 3]);
  });

  it("reads the codec string from an avcC box's profile, compatibility and level", () => {
    const avcC = box("avcC", Buffer.from([0x01, 0x64, 0x00, 0x1f, 0xff]));
    const init = Buffer.concat([box("ftyp", "isom"), box("moov", avcC)]);
    assert.equal(codecOf(init), "avc1.64001f");
  });

  it("finds a keyframe by its NAL unit type, not by position", () => {
    const idr = Buffer.concat([nal(1), nal(5), nal(1)]);
    const notIdr = Buffer.concat([nal(1), nal(7), nal(1)]);
    assert.ok(isKeyframe(box("mdat", idr)));
    assert.ok(!isKeyframe(box("mdat", notIdr)));
  });
});

describe("screenSizes", () => {
  it("reads the current and maximum framebuffer size from xrandr", () => {
    const output = "Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 8192 x 8192\n";
    assert.deepEqual(screenSizes(output), { width: 1920, height: 1080, maxWidth: 8192, maxHeight: 8192 });
  });

  it("reads nothing from output that names no current size", () => {
    assert.equal(screenSizes("no such display"), null);
  });
});
