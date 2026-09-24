import { describe, expect, it } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, maskPng } from './png';

function image(width: number, height: number, channels: 3 | 4, fill: number) {
  return { width, height, channels, pixels: Buffer.alloc(width * height * channels, fill) };
}

describe('png', () => {
  it('round-trips an RGBA and an RGB image', () => {
    for (const channels of [3, 4] as const) {
      const source = image(7, 5, channels, 200);
      source.pixels[3] = 9;
      const decoded = decodePng(encodePng(source));
      expect(decoded).toEqual(source);
    }
  });

  it('reads every PNG row filter', () => {
    // A 2x2 RGB image written with filters Sub (1) and Paeth (4), the way other encoders do.
    const width = 2;
    const rows = [
      [1, 10, 20, 30, 5, 5, 5], // Sub: second pixel = first + 5
      [4, 1, 1, 1, 0, 0, 0], // Paeth over the row above
    ];
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 2;
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, data, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const decoded = decodePng(png);
    expect([...decoded.pixels]).toEqual([10, 20, 30, 15, 25, 35, 11, 21, 31, 15, 25, 35]);
  });

  it('covers a rectangle opaque and leaves the rest', () => {
    const source = image(10, 10, 4, 255);
    const masked = decodePng(maskPng(encodePng(source), [{ x: 3, y: 3, width: 2, height: 2 }]));
    const at = (x: number, y: number) => [
      ...masked.pixels.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4),
    ];
    expect(at(4, 4)).toEqual([17, 17, 17, 255]);
    expect(at(2, 2)).toEqual([17, 17, 17, 255]); // grown by a pixel for antialiased edges
    expect(at(0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(9, 9)).toEqual([255, 255, 255, 255]);
  });

  it('scales CSS rectangles to image pixels and clips at the edges', () => {
    const source = image(8, 8, 3, 0);
    const masked = decodePng(maskPng(encodePng(source), [{ x: 3, y: 3, width: 5, height: 5 }], 2));
    expect(masked.pixels[(7 * 8 + 7) * 3]).toBe(17);
  });

  it('returns the picture unchanged when nothing is covered, and refuses what it cannot read', () => {
    const png = encodePng(image(2, 2, 3, 1));
    expect(maskPng(png, [])).toBe(png);
    expect(() =>
      maskPng(Buffer.from('not a png'), [{ x: 0, y: 0, width: 1, height: 1 }]),
    ).toThrow();
  });
});
