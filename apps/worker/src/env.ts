// Reads a positive-integer env var, falling back to `fallback` when it is unset,
// empty, non-numeric, or not greater than zero. Shared with the api (@helena/loop).
export { intEnv } from '@helena/loop';
