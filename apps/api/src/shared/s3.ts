// The api's stored files go through @repo/storage, which picks the local disk or an
// S3-compatible bucket; this module only keeps the old import path.
export {
  deleteObject,
  deleteObjects,
  getObject,
  getObjectText,
  putObject,
  warnIfStorageNotConfigured,
} from '@repo/storage';
