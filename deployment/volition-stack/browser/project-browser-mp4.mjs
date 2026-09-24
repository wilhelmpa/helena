// The live view's container work: ffmpeg writes the encoded frames as FLV, which frames every
// packet with its size up front, and the router rewrites each one at once as a fragment of
// fragmented MP4, which Media Source Extensions play and WebCodecs read the frame from.
//
// Why not ffmpeg's own fragmented MP4: its muxer writes a fragment only once the next frame
// arrives, because a sample's duration is the gap to the next one. That held every frame back
// by one frame interval (17 ms at 60 fps, 56 ms at 18 fps). FLV carries no such duration, so a
// frame leaves ffmpeg as soon as it is encoded; the fragment written here gives it the tier's
// nominal frame duration instead, which is all a live player needs.

// An MP4 box: its size, its four-letter type, then its payload.
function box(type, ...parts) {
  const payload = Buffer.concat(parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

// A full box: a box whose payload starts with a version byte and three flag bytes.
function fullBox(type, version, flags, ...parts) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, head, ...parts);
}

function u32(...values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32BE(value >>> 0, index * 4));
  return buffer;
}

const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
// Sample flags: a keyframe depends on no other sample; any other frame does and is no sync
// point (ISO/IEC 14496-12 8.8.3.1).
const KEY_SAMPLE = 0x02000000;
const DELTA_SAMPLE = 0x01010000;
export const TIMESCALE = 90_000;

// The initialization segment of one H.264 track of the given size, from the stream's decoder
// configuration record (the avcC box's payload, which FLV's AVC sequence header carries).
export function initSegment({ width, height, avcC }) {
  const ftyp = box("ftyp", "isom", u32(0x200), "isomiso6avc1mp41");
  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    u32(0, 0, 1000, 0, 0x00010000),
    Buffer.from([0x01, 0x00, 0, 0]),
    Buffer.alloc(8),
    MATRIX,
    Buffer.alloc(24),
    u32(2),
  );
  const tkhd = fullBox(
    "tkhd",
    0,
    3,
    u32(0, 0, 1, 0, 0),
    Buffer.alloc(8),
    Buffer.alloc(8),
    MATRIX,
    u32(width << 16, height << 16),
  );
  const mdhd = fullBox("mdhd", 0, 0, u32(0, 0, TIMESCALE, 0), Buffer.from([0x55, 0xc4, 0, 0]));
  const hdlr = fullBox("hdlr", 0, 0, u32(0), "vide", Buffer.alloc(12), "VideoHandler\0");
  const vmhd = fullBox("vmhd", 0, 1, Buffer.alloc(8));
  const dinf = box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)));
  const sampleEntry = Buffer.alloc(78);
  sampleEntry.writeUInt16BE(1, 6); // data reference index
  sampleEntry.writeUInt16BE(width, 24);
  sampleEntry.writeUInt16BE(height, 26);
  sampleEntry.writeUInt32BE(0x00480000, 28); // 72 dpi
  sampleEntry.writeUInt32BE(0x00480000, 32);
  sampleEntry.writeUInt16BE(1, 40); // frame count
  sampleEntry.writeUInt16BE(0x0018, 74); // depth
  sampleEntry.writeInt16BE(-1, 76);
  const avc1 = box("avc1", sampleEntry, box("avcC", avcC));
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), avc1),
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0, 0)),
    fullBox("stco", 0, 0, u32(0)),
  );
  const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", vmhd, dinf, stbl)));
  const mvex = box("mvex", fullBox("trex", 0, 0, u32(1, 1, 0, 0, 0)));
  return Buffer.concat([ftyp, box("moov", mvhd, trak, mvex)]);
}

// One frame as a movie fragment: moof (its sequence number, decode time, duration, size and
// whether it is a keyframe) and the mdat holding the frame's length-prefixed NAL units.
export function fragment({ sequence, decodeTime, duration, keyframe, sample }) {
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.max(0, Math.round(decodeTime))), 0);
  const trunFixed = (dataOffset) =>
    fullBox("trun", 0, 0x000701, u32(1, dataOffset, duration, sample.length, keyframe ? KEY_SAMPLE : DELTA_SAMPLE));
  const build = (dataOffset) =>
    box(
      "moof",
      fullBox("mfhd", 0, 0, u32(sequence)),
      box("traf", fullBox("tfhd", 0, 0x020000, u32(1)), fullBox("tfdt", 1, 0, time), trunFixed(dataOffset)),
    );
  // The data offset counts from the start of the moof to the first sample byte, past the
  // mdat's own 8-byte header; the moof's size does not depend on the offset's value.
  const moof = build(build(0).length + 8);
  return Buffer.concat([moof, box("mdat", sample)]);
}

// The complete FLV tags at the start of a buffer, after the file header when `header` is
// true, and the bytes after them. Each video tag's payload is read as AVC: `config` is a
// sequence header (the decoder configuration record), otherwise `sample` is one frame and
// `keyframe` says whether it is one. Other tags (script data) are skipped.
export function readFlvTags(buffer, header) {
  let offset = 0;
  if (header) {
    if (buffer.length < 13) return { tags: [], rest: buffer, header: true };
    if (buffer.toString("latin1", 0, 3) !== "FLV") throw new Error("Not an FLV stream");
    offset = buffer.readUInt32BE(5) + 4;
  }
  const tags = [];
  while (buffer.length - offset >= 11) {
    const type = buffer[offset];
    const size = buffer.readUIntBE(offset + 1, 3);
    if (buffer.length - offset < 11 + size + 4) break;
    const time = buffer.readUIntBE(offset + 4, 3) + buffer[offset + 7] * 0x1000000;
    const data = buffer.subarray(offset + 11, offset + 11 + size);
    offset += 11 + size + 4;
    if (type !== 9 || data.length < 5 || (data[0] & 0x0f) !== 7) continue;
    const packetType = data[1];
    if (packetType === 0) tags.push({ config: data.subarray(5), time });
    else if (packetType === 1) tags.push({ sample: data.subarray(5), keyframe: data[0] >> 4 === 1, time });
  }
  return { tags, rest: buffer.subarray(offset), header: false };
}
