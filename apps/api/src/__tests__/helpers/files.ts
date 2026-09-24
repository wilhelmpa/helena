// A real 1×1 PNG. Uploads check the magic number (file-type), so a test file that claims
// image/png has to start with one. `tail` appends bytes after the image end, which lets a
// test tell two files apart; image decoders stop at IEND.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export const PNG_SIZE = PNG.length;

export function png(tail = ''): Buffer {
  return Buffer.concat([PNG, Buffer.from(tail)]);
}

export function pngFile(name: string, tail = ''): File {
  return new File([png(tail)], name, { type: 'image/png' });
}
