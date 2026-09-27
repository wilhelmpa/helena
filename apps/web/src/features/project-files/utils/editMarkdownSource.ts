import { diffChars } from 'diff';

// Textareas expose LF even for source files containing CRLF or lone CR. Restore
// unchanged spans from the original, including their exact line-ending bytes.
export function editMarkdownSource(original: string, input: string): string | null {
  const normalized = original.replace(/\r\n?/g, '\n');
  if (normalized === input) return original;
  const changes = diffChars(normalized, input, { timeout: 100 });
  if (!changes) return null;
  let offset = 0;
  const output: string[] = [];
  for (const change of changes) {
    if (change.added) {
      output.push(change.value);
      continue;
    }
    const start = offset;
    for (let index = 0; index < change.value.length; index++) {
      if (original[offset] === '\r' && original[offset + 1] === '\n') offset++;
      offset++;
    }
    if (!change.removed) output.push(original.slice(start, offset));
  }
  return output.join('');
}
