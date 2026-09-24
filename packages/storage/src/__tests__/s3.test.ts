import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  deleteObject,
  deleteObjectFolder,
  getObject,
  getObjectText,
  putObject,
  storageConfigured,
} from '../index';
import { resetS3Client } from '../s3';

// A minimal path-style S3 that keeps objects in memory: PUT, GET, HEAD, DELETE and
// ListObjectsV2, enough to run the store the way MinIO or Garage would answer it. It
// records the requests so a test can see that a write went to the bucket.
const objects = new Map<string, { body: Uint8Array; type: string }>();
const requests: string[] = [];
let server: ReturnType<typeof Bun.serve>;

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = rest.map(decodeURIComponent).join('/');
      requests.push(`${request.method} ${bucket}/${key}`);
      if (request.method === 'GET' && !key && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const contents = keys
          .map(
            (k) =>
              `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects.get(k)!.body.length}</Size></Contents>`,
          )
          .join('');
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
          { headers: { 'content-type': 'application/xml' } },
        );
      }
      if (request.method === 'PUT') {
        objects.set(key, {
          body: new Uint8Array(await request.arrayBuffer()),
          type: request.headers.get('content-type') ?? 'application/octet-stream',
        });
        return new Response(null, { headers: { etag: '"x"' } });
      }
      if (request.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      const object = objects.get(key);
      if (!object) {
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
          { status: 404, headers: { 'content-type': 'application/xml' } },
        );
      }
      const headers = {
        'content-type': object.type,
        'content-length': String(object.body.length),
        etag: '"x"',
        'last-modified': new Date(0).toUTCString(),
      };
      if (request.method === 'HEAD') return new Response(null, { headers });
      return new Response(object.body, { headers });
    },
  });
});

afterAll(() => server.stop(true));

const saved = { ...process.env };
beforeEach(() => {
  objects.clear();
  requests.length = 0;
  delete process.env.STORAGE_ROOT;
  process.env.S3_ENDPOINT = `http://127.0.0.1:${server.port}`;
  process.env.S3_BUCKET = 'helena';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  resetS3Client();
});
afterEach(() => {
  for (const name of [
    'STORAGE_ROOT',
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetS3Client();
});

describe('S3 storage (Bun S3Client)', () => {
  it('writes to the bucket path-style and reads the bytes and type back', async () => {
    expect(storageConfigured()).toBe(true);
    await putObject('mail/7/message.eml', Buffer.from('From: a@example.com'), 'message/rfc822');
    expect(requests).toContain('PUT helena/mail/7/message.eml');

    const object = await getObject('mail/7/message.eml');
    expect(object.contentType).toBe('message/rfc822');
    expect(object.contentLength).toBe(19);
    expect(await new Response(object.body).text()).toBe('From: a@example.com');
    expect(await getObjectText('mail/7/message.eml')).toBe('From: a@example.com');
  });

  it('reports a missing object without naming it', async () => {
    await expect(getObject('mail/7/gone.eml')).rejects.toThrow(/^Object not found$/);
  });

  it('deletes one object and a whole key folder', async () => {
    await putObject('mail/7/a.eml', Buffer.from('a'), 'message/rfc822');
    await putObject('mail/7/sub/b.bin', Buffer.from('b'), 'application/octet-stream');
    await putObject('mail/70/c.eml', Buffer.from('c'), 'message/rfc822');
    await putObject('avatars/x', Buffer.from('x'), 'image/png');

    await deleteObject('avatars/x');
    await deleteObjectFolder('mail/7');

    expect([...objects.keys()]).toEqual(['mail/70/c.eml']);
  });

  it('prefers the local disk when STORAGE_ROOT is set too', async () => {
    process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), 'helena-storage-unit-'));
    await putObject('avatars/y', Buffer.from('y'), 'image/png');
    expect(requests).toEqual([]);
    expect(await getObjectText('avatars/y')).toBe('y');
  });
});
