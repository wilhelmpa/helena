import { S3Client } from 'bun';

// An S3-compatible bucket (MinIO, Garage, a hosted bucket) through Bun's built-in S3
// client, configured from S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and
// S3_SECRET_ACCESS_KEY. Requests are path-style (bucket in the path), which MinIO and most
// self-hosted gateways need; a store that serves only virtual-hosted buckets sets
// S3_FORCE_PATH_STYLE=false. S3_REGION defaults to us-east-1, which MinIO ignores.

let cached: S3Client | null = null;

function client(): S3Client {
  if (cached) return cached;
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 storage is not configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.',
    );
  }
  cached = new S3Client({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || 'us-east-1',
    virtualHostedStyle: process.env.S3_FORCE_PATH_STYLE === 'false',
  });
  return cached;
}

// Tests point the client at another endpoint between cases.
export function resetS3Client(): void {
  cached = null;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'NoSuchKey' || code === 'ERR_S3_FILE_NOT_FOUND';
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().write(key, body, { type: contentType });
}

// The error message never names the object: the public raw routes answer with it.
export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength?: number }> {
  const file = client().file(key);
  const stats = await file.stat().catch((error: unknown) => {
    throw new Error(isMissing(error) ? 'Object not found' : 'Object could not be read');
  });
  return {
    body: file.stream(),
    contentType: stats.type || 'application/octet-stream',
    contentLength: stats.size,
  };
}

export async function deleteObject(key: string): Promise<void> {
  await client().delete(key);
}

// Removes every object below a key folder, such as all stored mail of one account.
export async function deleteObjectFolder(folder: string): Promise<void> {
  const s3 = client();
  const prefix = `${folder.replace(/\/+$/, '')}/`;
  let continuationToken: string | undefined;
  do {
    const page = await s3.list({ prefix, continuationToken });
    await Promise.all((page.contents ?? []).map((object) => s3.delete(object.key)));
    continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (continuationToken);
}
