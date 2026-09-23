// An expected failure of a vault operation. The API maps `status` to its HTTP error;
// `code` tells a client which failure it is where the status alone does not.
export class VaultError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 413,
    message: string,
    public code?: 'conflict' | 'exists',
  ) {
    super(message);
  }
}

function hasCode(error: unknown, codes: string[]): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}

export function isMissing(error: unknown): boolean {
  return hasCode(error, ['ENOENT', 'ENOTDIR']);
}

// A file or folder the process may not read, such as one another service created
// without group access. The index leaves it out until its permissions allow it.
export function isUnreadable(error: unknown): boolean {
  return hasCode(error, ['EACCES', 'EPERM']);
}
