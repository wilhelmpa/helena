import { afterAll, beforeAll, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_TOOLS, setGoogleApiRootForTests } from '../google';

const pdf = await readFile(
  path.resolve(
    import.meta.dir,
    '../../../../apps/api/src/modules/chat-attachments/__tests__/fixtures/text.pdf',
  ),
);
const files: Record<
  string,
  { name: string; mimeType: string; bytes: Buffer; modifiedTime: string }
> = {
  pdf: {
    name: 'Beleg.pdf',
    mimeType: 'application/pdf',
    bytes: pdf,
    modifiedTime: '2026-08-15T00:00:00Z',
  },
  image: {
    name: 'Foto.png',
    mimeType: 'image/png',
    bytes: Buffer.from('image bytes'),
    modifiedTime: '2026-08-15T00:00:00Z',
  },
  doc: {
    name: 'Brief',
    mimeType: 'application/vnd.google-apps.document',
    bytes: pdf,
    modifiedTime: '2026-08-15T00:00:00Z',
  },
  huge: {
    name: 'Gross.pdf',
    mimeType: 'application/pdf',
    bytes: Buffer.alloc(1),
    modifiedTime: '2026-08-15T00:00:00Z',
  },
};
const requested: string[] = [];
let server: ReturnType<typeof Bun.serve>;
const auth = new OAuth2Client();
auth.setCredentials({ access_token: 'test' });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/files'))
        return Response.json({ files: [], nextPageToken: 'next' });
      const id = url.pathname.match(/\/files\/([^/]+)/)?.[1];
      const file = id ? files[id] : undefined;
      if (!file) return new Response('missing', { status: 404 });
      if (url.searchParams.get('alt') === 'media' || url.pathname.endsWith('/export'))
        return new Response(file.bytes);
      return Response.json({
        id,
        name: file.name,
        mimeType: file.mimeType,
        size: id === 'huge' ? String(51 * 1024 * 1024) : String(file.bytes.length),
        modifiedTime: file.modifiedTime,
      });
    },
  });
  setGoogleApiRootForTests(`http://127.0.0.1:${server.port}/`);
});

afterAll(() => {
  setGoogleApiRootForTests(null);
  server.stop(true);
});

const save = GOOGLE_TOOLS.find((entry) => entry.name === 'google_drive_save_to_vault')!;
const read = GOOGLE_TOOLS.find((entry) => entry.name === 'google_drive_read')!;

it('downloads PDF and image media and exports Google Docs as PDF', async () => {
  const saved: { fileId: string; mimeType: string; name: string; body: Buffer }[] = [];
  const context = {
    engine: 'helena' as const,
    email: 'test@example.com',
    auth,
    saveToVault: async (input: {
      stream: NodeJS.ReadableStream;
      fileId: string;
      mimeType: string;
      name: string;
    }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.stream) chunks.push(Buffer.from(chunk));
      saved.push({
        fileId: input.fileId,
        mimeType: input.mimeType,
        name: input.name,
        body: Buffer.concat(chunks),
      });
      return { vaultPath: `Projects/FAM/${input.name}` };
    },
  };
  for (const fileId of ['pdf', 'image', 'doc'])
    await save.handler({ account: 'test@example.com', fileId, folder: 'Files' }, context);
  expect(saved.map(({ mimeType }) => mimeType)).toEqual([
    'application/pdf',
    'image/png',
    'application/pdf',
  ]);
  expect(saved[0]!.body).toEqual(pdf);
  expect(saved[2]!.name).toBe('Brief.pdf');
  expect(
    requested.some((value) => value.includes('/files/pdf?') && value.includes('alt=media')),
  ).toBe(true);
  expect(requested.some((value) => value.includes('/files/doc/export'))).toBe(true);
});

it('rejects a known oversized file before downloading it', async () => {
  await expect(
    save.handler(
      { account: 'test@example.com', fileId: 'huge' },
      { engine: 'helena', email: 'test@example.com', auth, saveToVault: async () => null },
    ),
  ).rejects.toThrow('50 MB');
  expect(
    requested.some((value) => value.includes('/files/huge?') && value.includes('alt=media')),
  ).toBe(false);
});

it('returns text extracted from a Drive PDF', async () => {
  const result = (await read.handler(
    { account: 'test@example.com', fileId: 'pdf' },
    { engine: 'helena', email: 'test@example.com', auth },
  )) as { text: string };
  expect(result.text.length).toBeGreaterThan(0);
});

const search = GOOGLE_TOOLS.find((entry) => entry.name === 'google_drive_search')!;
it('preserves shared-with-me and parent queries and searches shared drives', async () => {
  for (const query of [
    'sharedWithMe',
    'sharedWithMe = true',
    "'folder' in parents",
    "'owner@example.com' in owners",
  ]) {
    const result = await search.handler(
      { account: 'test@example.com', query, pageToken: 'page' },
      { engine: 'helena', email: 'test@example.com', auth },
    );
    const url = new URL(requested.at(-1)!, 'http://localhost');
    expect(url.searchParams.get('q')).toBe(query);
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(url.searchParams.get('pageToken')).toBe('page');
    expect(result).toEqual({ files: [], nextPageToken: 'next' });
  }
});
