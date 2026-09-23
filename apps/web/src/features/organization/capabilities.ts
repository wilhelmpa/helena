const CAPABILITY = /^[a-z0-9][a-z0-9-]*$/;

// The capabilities typed as one line, in the form the API stores: lowercase words of at
// most 32 characters, each once, at most 16. Anything else is dropped.
export function parseCapabilities(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word.length <= 32 && CAPABILITY.test(word));
  return [...new Set(words)].slice(0, 16);
}
