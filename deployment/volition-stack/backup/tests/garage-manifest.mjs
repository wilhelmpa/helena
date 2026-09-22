import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'garage',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.S3_BUCKET;
let token;
const rows = [];
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
  );
  for (const item of page.Contents ?? []) {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of object.Body) {
      hash.update(chunk);
      size += chunk.length;
    }
    rows.push([item.Key, size, hash.digest('hex'), object.ContentType ?? '']);
  }
  token = page.NextContinuationToken;
} while (token);
rows.sort((a, b) => a[0].localeCompare(b[0]));
const manifest = createHash('sha256');
for (const row of rows) manifest.update(`${JSON.stringify(row)}\n`);
console.log(
  JSON.stringify({
    count: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row[1], 0),
    sha256: manifest.digest('hex'),
  }),
);
