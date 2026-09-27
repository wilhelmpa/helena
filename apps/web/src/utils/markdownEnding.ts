export function preserveMarkdownEnding(original: string, serialized: string): string {
  return serialized.replace(/\n+$/, '') + (original.match(/\n*$/)?.[0] ?? '');
}
