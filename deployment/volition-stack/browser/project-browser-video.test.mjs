import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fragment, initSegment, readFlvTags } from "./project-browser-mp4.mjs";
import {
  chooseTier,
  codecOf,
  encoderArguments,
  isKeyframe,
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
  it("starts a fresh viewer on a safe middle tier before its first real measurement", () => {
    // Not "low": that would make a fast connection wait out several rises for no reason.
    // Not "high": that would risk a burst of frames a slow connection cannot drain, before
    // its first ping and stats report arrive to say so.
    assert.equal(TIERS[chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 }, null)].name, "medium");
    assert.equal(TIERS[chooseTier({ downlinkKbps: 0, rttMs: 0, bufferedBytes: 0 })].name, "medium");
  });

  it("sets the ceiling from the round trip alone while its tier's encoder sends little", () => {
    const mediumIndex = TIERS.findIndex((tier) => tier.name === "medium");
    // A quiet page's tier produces little regardless of the connection; a low downlink
    // reading alone must not hold a fast, idle connection back from rising.
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 5, rttMs: 20, encodedKbps: 10 }, mediumIndex)].name,
      "high",
    );
    // A genuinely slow round trip still rules a tier out on its own.
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 5, rttMs: 400, encodedKbps: 10 }, mediumIndex)].name,
      "low",
    );
  });

  it("holds a low downlink against a tier once its own encoder is sending enough to judge by", () => {
    const highIndex = TIERS.findIndex((tier) => tier.name === "high");
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 100, rttMs: 20, encodedKbps: 3000 }, highIndex)].name,
      "low",
    );
  });

  it("judges a shortfall against what the tier is actually sending, not a fixed number", () => {
    // A downlink comfortably below a fixed "high" threshold is still not a shortfall against
    // a tier sending far less than that itself.
    const mediumIndex = TIERS.findIndex((tier) => tier.name === "medium");
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 900, rttMs: 20, encodedKbps: 1200 }, mediumIndex)].name,
      "high",
    );
    // The same downlink is a real shortfall once the tier is sending enough that receiving
    // well under it means the connection cannot keep up, not merely that the tier is modest.
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 900, rttMs: 20, encodedKbps: 6000 }, mediumIndex)].name,
      "low",
    );
  });

  it("drops to the worst tier when the socket has a real backlog, or its stats have gone stale", () => {
    const highIndex = TIERS.findIndex((tier) => tier.name === "high");
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 500_000 }, highIndex)].name,
      "low",
    );
    // A viewer still on a video tier whose last report is old enough is assumed congested:
    // the report that would say otherwise travels the same connection as the video, and can
    // be stuck behind the very backlog it would describe.
    assert.equal(
      TIERS[chooseTier({ downlinkKbps: 6000, rttMs: 20, feedbackAgeMs: 9_000 }, highIndex)].name,
      "low",
    );
  });

  it("rises one tier at a time but drops as far as the numbers call for", () => {
    const lowIndex = TIERS.findIndex((tier) => tier.name === "low");
    const mediumIndex = TIERS.findIndex((tier) => tier.name === "medium");
    const highIndex = TIERS.findIndex((tier) => tier.name === "high");
    // A connection now good enough for "high" only rises to "medium" from "low".
    const risen = chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 }, lowIndex);
    assert.equal(risen, mediumIndex);
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
    const medium = TIERS[mediumIndex];
    assert.equal(
      chooseTier({ downlinkKbps: medium.maxKbps + 500, rttMs: 100, bufferedBytes: 0 }, mediumIndex),
      mediumIndex,
    );
  });

  it("does not retry a tier just dropped from until the cooldown clears", () => {
    const lowIndex = TIERS.findIndex((tier) => tier.name === "low");
    const mediumIndex = TIERS.findIndex((tier) => tier.name === "medium");
    // Numbers that would otherwise afford "medium" right away still keep a viewer on "low"
    // while the drop that put it there is recent: retrying at once, on every reassessment,
    // would either repeat the very shortfall it was just dropped for, or thrash a connection
    // sitting right at a tier's cap back and forth every couple of reports.
    assert.equal(
      chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0, droppedAgoMs: 1_000 }, lowIndex),
      lowIndex,
    );
    // The same numbers reach "medium" once the cooldown has cleared.
    assert.equal(
      chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0, droppedAgoMs: 9_000 }, lowIndex),
      mediumIndex,
    );
    // A viewer that has never been dropped (the default, an unmeasured droppedAgoMs) is
    // governed by the round trip alone, exactly as before this existed.
    assert.equal(chooseTier({ downlinkKbps: 6000, rttMs: 20, bufferedBytes: 0 }, lowIndex), mediumIndex);
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
    assert.equal(args[args.indexOf("-bf") + 1], "0");
    // More than one thread must not cost latency: sliced, not frame, parallelism.
    assert.equal(args[args.indexOf("-x264-params") + 1], "sliced-threads=1:rc-lookahead=0:sync-lookahead=0");
    // No probe backlog behind a live grab, and every frame out the moment it is encoded.
    assert.equal(args[args.indexOf("-fflags") + 1], "nobuffer");
    assert.ok(args.indexOf("-fflags") < args.indexOf("-i"));
    assert.equal(args[args.indexOf("-f", args.indexOf("-i")) + 1], "flv");
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

  it("caps a constrained tier's peak bitrate with a VBV window, on top of its CRF", () => {
    const medium = TIERS.find((tier) => tier.name === "medium");
    const args = encoderArguments({ display: 87, x: 0, y: 0, width: 1280, height: 800 }, medium);
    assert.equal(args[args.indexOf("-crf") + 1], String(medium.crf));
    assert.equal(args[args.indexOf("-maxrate") + 1], `${medium.maxKbps}k`);
    assert.equal(args[args.indexOf("-bufsize") + 1], `${medium.bufKbps}k`);
  });

  it("leaves high uncapped: a LAN or the local kiosk should spend the bandwidth it has", () => {
    const high = TIERS.find((tier) => tier.name === "high");
    const args = encoderArguments({ display: 87, x: 0, y: 32, width: 1280, height: 800 }, high);
    assert.ok(!args.includes("-maxrate"));
    assert.ok(!args.includes("-bufsize"));
  });
});

describe("MP4 box reading", () => {
  it("reads the codec string from an avcC box's profile, compatibility and level", () => {
    const avcC = box("avcC", Buffer.from([0x01, 0x64, 0x00, 0x1f, 0xff]));
    const init = Buffer.concat([box("ftyp", "isom"), box("moov", avcC)]);
    assert.equal(codecOf(init), "avc1.64001f");
  });

  it("finds a keyframe by its NAL unit type, not by position", () => {
    assert.ok(isKeyframe(Buffer.concat([nal(1), nal(5), nal(1)])));
    assert.ok(!isKeyframe(Buffer.concat([nal(1), nal(7), nal(1)])));
  });
});

// One FLV tag: type, 24-bit size, 24+8-bit time, stream id, payload, previous tag size.
function flvTag(type, time, payload) {
  const head = Buffer.alloc(11);
  head[0] = type;
  head.writeUIntBE(payload.length, 1, 3);
  head.writeUIntBE(time & 0xffffff, 4, 3);
  head[7] = time >>> 24;
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(11 + payload.length, 0);
  return Buffer.concat([head, payload, tail]);
}
const FLV_HEADER = Buffer.from([0x46, 0x4c, 0x56, 1, 1, 0, 0, 0, 9, 0, 0, 0, 0]);

describe("FLV in, fragmented MP4 out", () => {
  const config = Buffer.from([0x01, 0x42, 0xc0, 0x1f, 0xff, 0xe1]);
  const frame = Buffer.concat([nal(5), nal(1)]);

  it("reads the AVC sequence header and each frame as soon as its tag is complete", () => {
    const stream = Buffer.concat([
      FLV_HEADER,
      flvTag(18, 0, Buffer.from("script")),
      flvTag(9, 0, Buffer.concat([Buffer.from([0x17, 0, 0, 0, 0]), config])),
      flvTag(9, 17, Buffer.concat([Buffer.from([0x17, 1, 0, 0, 0]), frame])),
    ]);
    const partial = readFlvTags(stream.subarray(0, stream.length - 3), true);
    assert.equal(partial.tags.length, 1);
    assert.deepEqual([...partial.tags[0].config], [...config]);
    const { tags, rest } = readFlvTags(stream, true);
    assert.equal(tags.length, 2);
    assert.equal(tags[1].keyframe, true);
    assert.equal(tags[1].time, 17);
    assert.deepEqual([...tags[1].sample], [...frame]);
    assert.equal(rest.length, 0);
  });

  it("writes an initialization segment whose codec string and size the viewers read", () => {
    const init = initSegment({ width: 2560, height: 1600, avcC: config });
    assert.equal(init.toString("latin1", 4, 8), "ftyp");
    assert.equal(codecOf(init), "avc1.42c01f");
    const at = init.indexOf("avc1", init.indexOf("stsd", 0, "latin1"), "latin1");
    assert.equal(init.readUInt16BE(at + 4 + 24), 2560);
    assert.equal(init.readUInt16BE(at + 4 + 26), 1600);
  });

  it("writes one frame as moof+mdat with the data offset pointing at the frame", () => {
    const out = fragment({ sequence: 3, decodeTime: 4500, duration: 1500, keyframe: true, sample: frame });
    const moofSize = out.readUInt32BE(0);
    assert.equal(out.toString("latin1", 4, 8), "moof");
    assert.equal(out.toString("latin1", moofSize + 4, moofSize + 8), "mdat");
    const trun = out.indexOf("trun", 0, "latin1");
    const dataOffset = out.readUInt32BE(trun + 12);
    assert.equal(dataOffset, moofSize + 8);
    assert.deepEqual([...out.subarray(dataOffset)], [...frame]);
    assert.equal(out.readUInt32BE(trun + 16), 1500);
    assert.equal(out.readUInt32BE(trun + 24), 0x02000000);
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
