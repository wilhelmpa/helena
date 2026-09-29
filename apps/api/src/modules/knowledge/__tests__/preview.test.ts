import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from '#shared/lib';
import { previewFile, previewMetadata, previewTable, previewType } from '../preview';
import { convertOffice, handlePreviewRequest, tableOffice } from '../preview-worker';

const fixture = (name: string) => path.join(import.meta.dir, 'fixtures', name);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'volition-preview-test-'));
const previousRoot = process.env.PROJECT_VAULT_ROOT;
process.env.PROJECT_VAULT_ROOT = temporary;
afterAll(async () => {
  if (previousRoot === undefined) delete process.env.PROJECT_VAULT_ROOT;
  else process.env.PROJECT_VAULT_ROOT = previousRoot;
  await rm(temporary, { recursive: true, force: true });
});

describe('vault previews', () => {
  it('classifies office, tables, code, media and unknown files', () => {
    expect(previewType('slides.PPTX').kind).toBe('office');
    expect(previewType('data.tsv').kind).toBe('table');
    expect(previewType('app.tsx')).toMatchObject({ kind: 'text', language: 'typescript' });
    expect(previewType('song.mp3').kind).toBe('media');
    expect(previewType('archive.zip').kind).toBe('unsupported');
  });

  it('returns text and bounded CSV data', async () => {
    await writeFile(path.join(temporary, 'code.ts'), 'const answer = 42;');
    await writeFile(path.join(temporary, 'data.csv'), 'Name,Value\nAlpha,42\n');
    expect(await previewMetadata('code.ts')).toMatchObject({
      kind: 'text',
      language: 'typescript',
      content: 'const answer = 42;',
    });
    expect(await previewTable('data.csv')).toMatchObject({
      sheets: [
        {
          rows: [
            ['Name', 'Value'],
            ['Alpha', '42'],
          ],
        },
      ],
    });
    await writeFile(
      path.join(temporary, 'wide.tsv'),
      Array.from({ length: 2001 }, () => Array(101).fill('x').join('\t')).join('\n'),
    );
    const wide = await previewTable('wide.tsv');
    expect(wide.sheets[0].rows).toHaveLength(2000);
    expect(wide.sheets[0].rows[0]).toHaveLength(100);
    expect(wide.sheets[0].truncated).toBe(true);
  });

  it('streams media byte ranges and delegates office conversion', async () => {
    await writeFile(path.join(temporary, 'clip.mp4'), '0123456789');
    const media = await previewFile(
      'clip.mp4',
      new Request('http://localhost', { headers: { range: 'bytes=3-5' } }),
    );
    expect(media.status).toBe(206);
    expect(await media.text()).toBe('345');
    await writeFile(path.join(temporary, 'document.docx'), await readFile(fixture('preview.docx')));
    let called = 0;
    const office = await previewFile(
      'document.docx',
      new Request('http://localhost'),
      async (_bytes, extension, format) => {
        called += 1;
        expect([extension, format]).toEqual(['.docx', 'pdf']);
        return new Response('%PDF-1.4', { headers: { 'X-Preview-Cache': 'hit' } });
      },
    );
    expect(called).toBe(1);
    expect(office.headers.get('content-type')).toBe('application/pdf');
    expect(office.headers.get('x-preview-cache')).toBe('hit');
  });

  it('maps converter timeout and damaged-file failures to clear statuses', async () => {
    const request = () =>
      new Request('http://localhost/convert?extension=.docx&format=pdf', {
        method: 'POST',
        body: 'office',
      });
    const timeout = await handlePreviewRequest(request(), async () => {
      throw new Error('Conversion timed out');
    });
    expect(timeout.status).toBe(504);
    const damaged = await handlePreviewRequest(request(), async () => {
      throw new Error('The office document is damaged or unsupported');
    });
    expect(damaged.status).toBe(422);
    await writeFile(path.join(temporary, 'bad.xlsx'), 'broken');
    expect(
      previewTable('bad.xlsx', async () => new Response('invalid JSON')),
    ).rejects.toMatchObject({
      status: 422,
    } satisfies Partial<HttpError>);
  });
});

describe('real LibreOffice conversion', () => {
  it.skipIf(!Bun.which('soffice'))(
    'converts docx, xlsx and pptx, then hits the SHA cache',
    async () => {
      const cache = path.join(temporary, 'cache');
      for (const extension of ['docx', 'xlsx', 'pptx'] as const) {
        const bytes = await readFile(fixture(`preview.${extension}`));
        const first = await convertOffice(bytes, `.${extension}`, 'pdf', cache);
        expect(first.cached).toBe(false);
        expect((await readFile(first.file)).subarray(0, 4).toString()).toBe('%PDF');
        const second = await convertOffice(bytes, `.${extension}`, 'pdf', cache);
        expect(second).toEqual({ file: first.file, cached: true });
        if (extension === 'docx') {
          const changed = await convertOffice(
            Buffer.concat([bytes, Buffer.from([0])]),
            '.docx',
            'pdf',
            cache,
          );
          expect(changed.cached).toBe(false);
          expect(changed.file).not.toBe(first.file);
        }
      }
      const spreadsheet = await readFile(fixture('preview.xlsx'));
      const table = await tableOffice(spreadsheet, '.xlsx', cache);
      expect(JSON.parse(await readFile(table.file, 'utf8'))).toMatchObject({
        sheets: [
          {
            name: 'Data',
            rows: [
              ['Name', 'Value'],
              ['Preview', '42'],
            ],
          },
        ],
      });
      expect((await tableOffice(spreadsheet, '.xlsx', cache)).cached).toBe(true);
    },
  );
});
