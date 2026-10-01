import { expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GOOGLE_TOOLS, gogBroker, type GoogleToolContext } from '../google';

const find = (name: string) => GOOGLE_TOOLS.find((tool) => tool.name === name)!;
const pdf = await readFile(
  new URL(
    '../../../../apps/api/src/modules/chat-attachments/__tests__/fixtures/text.pdf',
    import.meta.url,
  ),
);
const calls: { command: string; args: string[] }[] = [];
let meta = {
  id: 'pdf',
  name: 'Beleg.pdf',
  mimeType: 'application/pdf',
  size: String(pdf.length),
  modifiedTime: '2026-10-01T00:00:00Z',
};
let bytes = pdf;
const ctx: GoogleToolContext = {
  engine: 'gog',
  email: 'test@example.com',
  gog: async (command, args) => {
    calls.push({ command, args });
    if (command === 'drive.search') return { files: [meta], nextPageToken: 'next' };
    if (command === 'drive.get') return { file: meta };
    if (command === 'drive.download') return { base64: bytes.toString('base64') };
    throw new Error(`Unexpected command: ${command}`);
  },
};

it('offers search, read and vault copy for gog but keeps share/delete unavailable', () => {
  for (const name of ['google_drive_search', 'google_drive_read', 'google_drive_save_to_vault'])
    expect(find(name).gogCommand).not.toBeNull();
  for (const name of ['google_drive_share', 'google_drive_delete'])
    expect(find(name).gogCommand).toBeNull();
});

it('searches shared files with raw Drive syntax and preserves pagination', async () => {
  const result = await find('google_drive_search').handler(
    { query: 'sharedWithMe', max: 30, pageToken: 'page' },
    ctx,
  );
  expect(calls.at(-1)).toEqual({
    command: 'drive.search',
    args: ['drive', 'search', 'sharedWithMe', '--raw-query', '--max=30', '--page=page'],
  });
  expect(result).toEqual({ files: [meta], nextPageToken: 'next' });
});

it('reads PDF text and copies original bytes with receipt options through the vault writer', async () => {
  const read = (await find('google_drive_read').handler({ fileId: 'pdf' }, ctx)) as {
    text: string;
  };
  expect(read.text.length).toBeGreaterThan(0);
  const saved: unknown[] = [];
  const result = await find('google_drive_save_to_vault').handler(
    { fileId: 'pdf', folder: 'Files/Belege/2026-07', asReceipt: true },
    {
      ...ctx,
      saveToVault: async (input) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(pdf);
        expect(input.stream).toBeInstanceOf(Readable);
        saved.push({ ...input, stream: undefined });
        return { vaultPath: 'Projects/FAM/Files/Belege/2026-07/Beleg.pdf' };
      },
    },
  );
  expect(saved).toEqual([
    {
      fileId: 'pdf',
      name: 'Beleg.pdf',
      mimeType: 'application/pdf',
      modifiedTime: meta.modifiedTime,
      folder: 'Files/Belege/2026-07',
      asReceipt: true,
      stream: undefined,
    },
  ]);
  expect(result).toEqual({ vaultPath: 'Projects/FAM/Files/Belege/2026-07/Beleg.pdf' });
});

it('exports Google Docs as PDF and rejects folders and oversized media before download', async () => {
  const original = meta;
  try {
    meta = { ...original, mimeType: 'application/vnd.google-apps.document', name: 'Brief' };
    await find('google_drive_save_to_vault').handler(
      { fileId: 'pdf' },
      {
        ...ctx,
        saveToVault: async (input) => {
          expect(input.name).toBe('Brief.pdf');
          expect(input.mimeType).toBe('application/pdf');
          return null;
        },
      },
    );
    expect(calls.at(-1)?.args).toEqual(['drive', 'download', 'pdf', '--format=pdf']);
    for (const change of [
      { mimeType: 'application/vnd.google-apps.folder' },
      { size: String(51 * 1024 * 1024) },
    ]) {
      meta = { ...original, ...change };
      const count = calls.filter((call) => call.command === 'drive.download').length;
      await expect(
        find('google_drive_save_to_vault').handler(
          { fileId: 'pdf' },
          { ...ctx, saveToVault: async () => null },
        ),
      ).rejects.toThrow();
      expect(calls.filter((call) => call.command === 'drive.download').length).toBe(count);
    }
    meta = { ...original, mimeType: 'application/vnd.google-apps.document' };
    bytes = Buffer.from('Google document text');
    expect(await find('google_drive_read').handler({ fileId: 'pdf' }, ctx)).toMatchObject({
      text: 'Google document text',
    });
    expect(calls.at(-1)?.args).toEqual(['drive', 'download', 'pdf', '--format=txt']);
  } finally {
    meta = original;
    bytes = pdf;
  }
});

it('transports binary Drive content larger than the former 8 MB JSON limit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'volition-gog-test-'));
  try {
    const script = path.join(directory, 'broker.py');
    await writeFile(
      script,
      "import sys,json,base64\nsys.stdin.read()\nprint(json.dumps({'ok': True, 'result': {'base64': base64.b64encode(b'x' * (9 * 1024 * 1024)).decode('ascii')}}))\n",
    );
    const result = (await gogBroker(`python3 ${script}`).call({
      op: 'run',
      email: 'test@example.com',
      command: 'drive.download',
      args: ['drive', 'download', 'pdf'],
    })) as { base64: string };
    expect(Buffer.from(result.base64, 'base64').length).toBe(9 * 1024 * 1024);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects malformed broker bytes instead of saving corrupted files', async () => {
  await expect(
    find('google_drive_save_to_vault').handler(
      { fileId: 'pdf' },
      {
        ...ctx,
        gog: async (command) => (command === 'drive.get' ? meta : { base64: 'invalid!' }),
        saveToVault: async () => {
          throw new Error('Vault writer must not be called');
        },
      },
    ),
  ).rejects.toThrow('invalid or oversized');
});
