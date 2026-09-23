import * as local from './storage-local';
import * as s3 from './storage-s3';

// Stored files: attachments, document assets, skill files, avatars. Only the bytes are
// kept here; the metadata and the object key are in the database rows of the feature
// that owns the file. The files go to the local disk when STORAGE_ROOT is set, and to an
// S3-compatible bucket when the S3_* variables are set instead.

type ObjectStore = Pick<typeof s3, 'putObject' | 'getObject' | 'deleteObject'>;

const NOT_CONFIGURED =
  'File storage is not configured: set STORAGE_ROOT to a directory on the local disk, or S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for an S3-compatible store.';

function selectedStore(): ObjectStore | null {
  if (process.env.STORAGE_ROOT?.trim()) return local;
  if (process.env.S3_ENDPOINT?.trim()) return s3;
  return null;
}

function store(): ObjectStore {
  const selected = selectedStore();
  if (!selected) throw new Error(NOT_CONFIGURED);
  return selected;
}

// Without storage the api still serves everything except uploads and downloads.
export function warnIfStorageNotConfigured(): void {
  if (!selectedStore()) console.warn(`[planner] ${NOT_CONFIGURED}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  return store().putObject(key, body, contentType);
}

// Returns a web ReadableStream of the object body so a route can stream it to
// the client without buffering the whole file (matters for video). contentType
// and contentLength fall back to sensible defaults when the store omits them.
export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength?: number }> {
  return store().getObject(key);
}

// Reads a whole object into a UTF-8 string. For small text objects (skill
// markdown and references); do not use for large binaries — it buffers fully.
export async function getObjectText(key: string): Promise<string> {
  const { body } = await getObject(key);
  return new Response(body).text();
}

export async function deleteObject(key: string): Promise<void> {
  return store().deleteObject(key);
}

// Deletes several objects, best-effort (a failed delete only orphans bytes).
export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      deleteObject(key).catch((err) => {
        console.error(`[planner] failed to delete object ${key}:`, err);
      }),
    ),
  );
}
