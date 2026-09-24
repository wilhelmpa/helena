import { describe, expect, it } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { detectUploadType, extensionForMime, mimeFromName, UploadTypeMismatchError } from '../mime';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const CFB = Uint8Array.from([
  0xd0,
  0xcf,
  0x11,
  0xe0,
  0xa1,
  0xb1,
  0x1a,
  0xe1,
  ...new Array(504).fill(0),
]);
const EXE = Uint8Array.from([
  0x4d,
  0x5a,
  0x90,
  0,
  3,
  0,
  0,
  0,
  4,
  0,
  0,
  0,
  0xff,
  0xff,
  ...new Array(50).fill(0),
]);
const text = (value: string) => new TextEncoder().encode(value);

// A ZIP with one stored entry, enough for file-type to see a plain archive.
function zip(name: string, content: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(content));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  return new Uint8Array(Buffer.concat([header, Buffer.from(name), data]));
}

describe('mimeFromName', () => {
  it('answers the types the four old maps did', () => {
    expect(mimeFromName('a.pdf')).toBe('application/pdf');
    expect(mimeFromName('A.JPEG')).toBe('image/jpeg');
    expect(mimeFromName('note.md')).toBe('text/markdown');
    expect(mimeFromName('board.canvas')).toBe('application/json');
    expect(mimeFromName('config.yml')).toBe('application/yaml');
    expect(mimeFromName('song.flac')).toBe('audio/flac');
    expect(mimeFromName('clip.m4v')).toBe('video/mp4');
    expect(mimeFromName('mail.eml')).toBe('message/rfc822');
    expect(mimeFromName('x.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('serves source code as text/plain, not as the media mime-db names', () => {
    expect(mimeFromName('main.ts')).toBe('text/plain');
    expect(mimeFromName('app.js')).toBe('text/plain');
  });

  it('falls back to application/octet-stream', () => {
    expect(mimeFromName('README')).toBe('application/octet-stream');
    expect(mimeFromName('x.unknownext')).toBe('application/octet-stream');
  });
});

describe('extensionForMime', () => {
  it('names the usual extension', () => {
    expect(extensionForMime('application/pdf')).toBe('.pdf');
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('text/calendar; charset=utf-8')).toBe('.ics');
    expect(extensionForMime('message/rfc822')).toBe('.eml');
    expect(extensionForMime('application/x-nothing')).toBe('.bin');
  });
});

describe('detectUploadType', () => {
  it('keeps a claim the bytes prove', async () => {
    expect(await detectUploadType(PNG, 'a.png', 'image/png')).toBe('image/png');
    expect(await detectUploadType(PDF, 'a.pdf', 'application/pdf')).toBe('application/pdf');
  });

  it('refuses a binary claim without its signature', async () => {
    await expect(detectUploadType(text('<html>'), 'a.png', 'image/png')).rejects.toBeInstanceOf(
      UploadTypeMismatchError,
    );
    await expect(detectUploadType(text('hello'), 'a.pdf', '')).rejects.toBeInstanceOf(
      UploadTypeMismatchError,
    );
  });

  it('stores recognised bytes as what they are', async () => {
    expect(await detectUploadType(EXE, 'cat.png', 'image/png')).toBe('application/x-msdownload');
    expect(await detectUploadType(PNG, 'shot.txt', 'text/plain')).toBe('image/png');
    expect(await detectUploadType(PNG, 'shot', '')).toBe('image/png');
  });

  it('takes the name when the client declares nothing or octet-stream', async () => {
    expect(await detectUploadType(text('# hi'), 'note.md', '')).toBe('text/markdown');
    expect(await detectUploadType(text('a;b'), 'x.csv', 'application/octet-stream')).toBe(
      'text/csv',
    );
    expect(await detectUploadType(text('a;b'), 'x.csv', 'text/csv; charset=utf-8')).toBe(
      'text/csv',
    );
  });

  it('keeps a text claim over a heuristic text guess', async () => {
    const svg = text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await detectUploadType(svg, 'x.svg', 'image/svg+xml')).toBe('image/svg+xml');
    expect(await detectUploadType(svg, 'x.txt', 'text/plain')).toBe('text/plain');
  });

  it('keeps a specific format inside its container, not a text claim', async () => {
    expect(await detectUploadType(CFB, 'old.doc', 'application/msword')).toBe('application/msword');
    expect(await detectUploadType(CFB, 'old.xls', '')).toBe('application/vnd.ms-excel');
    const archive = zip('data.bin', 'hello');
    expect(await detectUploadType(archive, 'x.zip', 'application/zip')).toBe('application/zip');
    expect(await detectUploadType(archive, 'x.txt', 'text/plain')).toBe('application/zip');
  });

  it('lets a Windows CSV claimed as Excel through', async () => {
    expect(await detectUploadType(text('a;b\n1;2'), 'x.csv', 'application/vnd.ms-excel')).toBe(
      'application/vnd.ms-excel',
    );
  });
});
