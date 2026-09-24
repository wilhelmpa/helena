import pngjs from 'pngjs';

// Covers rectangles of a PNG screenshot in the image itself (design §6: "Screenshots decken
// gefüllte Felder ab"). Done on the pixels rather than by drawing boxes into the page first,
// so a page never sees the gateway add anything to its DOM (a MutationObserver would, and it
// is one more automation signal, design §7), and so a field the page switched to type=text
// ("Passwort anzeigen") is still covered: the rectangles come from the fields the gateway
// filled, not from what the page says they are now. Decoding and encoding are pngjs's (MIT);
// a picture it cannot read is refused, and the caller then refuses the screenshot instead of
// returning it uncovered.

const { PNG } = pngjs;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Decoded {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Buffer;
}

const COVER = [17, 17, 17, 255];

// Always RGBA (pngjs expands every colour type and bit depth to 8-bit RGBA).
export function decodePng(png: Buffer): Decoded {
  const image = PNG.sync.read(png);
  return { width: image.width, height: image.height, channels: 4, pixels: image.data };
}

export function encodePng(image: Decoded): Buffer {
  const { width, height, channels, pixels } = image;
  const rgba =
    channels === 4
      ? pixels
      : (() => {
          const out = Buffer.alloc(width * height * 4, 255);
          for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) pixels.copy(out, j, i, i + 3);
          return out;
        })();
  return PNG.sync.write(Object.assign(new PNG({ width, height }), { data: rgba }), {
    colorType: 6,
  });
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
