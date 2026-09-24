import { deflateSync, inflateSync } from 'node:zlib';

// Covers rectangles of a PNG screenshot in the image itself (design §6: "Screenshots decken
// gefüllte Felder ab"). Done on the pixels rather than by drawing boxes into the page first,
// so a page never sees the gateway add anything to its DOM (a MutationObserver would, and it
// is one more automation signal, design §7), and so a field the page switched to type=text
// ("Passwort anzeigen") is still covered: the rectangles come from the fields the gateway
// filled, not from what the page says they are now.
//
// Reads what Chromium's screenshots are: 8-bit truecolour (RGB or RGBA), not interlaced.
// Anything else is refused rather than guessed at, and the caller then refuses the
// screenshot instead of returning it uncovered.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COVER = [17, 17, 17, 255];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

interface Decoded {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(png: Buffer): Decoded {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 | 0 = 0;
  const data: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error('unsupported PNG format');
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      data.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height || !channels) throw new Error('PNG without a header');
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[i - channels]! : 0;
      const above = up ? up[i]! : 0;
      const upperLeft = up && i >= channels ? up[i - channels]! : 0;
      const value = line[i]!;
      switch (filter) {
        case 0:
          out[i] = value;
          break;
        case 1:
          out[i] = (value + left) & 0xff;
          break;
        case 2:
          out[i] = (value + above) & 0xff;
          break;
        case 3:
          out[i] = (value + ((left + above) >> 1)) & 0xff;
          break;
        case 4:
          out[i] = (value + paeth(left, above, upperLeft)) & 0xff;
          break;
        default:
          throw new Error('unsupported PNG filter');
      }
    }
  }
  return { width, height, channels, pixels };
}

export function encodePng(image: Decoded): Buffer {
  const { width, height, channels, pixels } = image;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Paints each rectangle (in image pixels; `scale` converts from the CSS pixels the caller
// measured in) opaque, rounded outward and grown by a pixel so antialiased edges are gone too.
export function maskPng(png: Buffer, rects: Rect[], scale = 1): Buffer {
  if (rects.length === 0) return png;
  const image = decodePng(png);
  const { width, height, channels, pixels } = image;
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x * scale) - 1);
    const y0 = Math.max(0, Math.floor(rect.y * scale) - 1);
    const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * scale) + 1);
    const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * scale) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * width + x) * channels;
        for (let c = 0; c < channels; c++) pixels[at + c] = COVER[c]!;
      }
    }
  }
  return encodePng(image);
}
