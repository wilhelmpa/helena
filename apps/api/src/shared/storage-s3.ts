import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// S3-compatible object store (MinIO, Garage, a hosted bucket). Config comes from env.
// forcePathStyle is required for MinIO (and most self-hosted S3 gateways) because they
// do not serve virtual-host-style buckets; hosted stores that only serve
// virtual-host-style buckets set S3_FORCE_PATH_STYLE=false. region is sent but ignored
// by MinIO; a value is still required by the SDK.

let cached: { client: S3Client; bucket: string } | null = null;

function getClient(): { client: S3Client; bucket: string } {
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
  cached = {
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    }),
    bucket,
  };
  return cached;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength?: number }> {
  const { client, bucket } = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Object '${key}' has no body`);
  return {
    body: (res.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream(),
    contentType: res.ContentType || 'application/octet-stream',
    contentLength: res.ContentLength,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
