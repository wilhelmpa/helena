// A text an agent wrote with its line breaks escaped — one line with literal "\n" in it — is
// shown with real breaks (owner, 28.09.: task descriptions read as a wall of text). The API
// stores new descriptions this way already (modules/issues/description.ts); this reads the
// ones written before.
export function readableText(text: string): string {
  if (text.includes('\n') || !text.includes('\\n')) return text;
  return text.replace(/\\r\\n|\\n/g, '\n');
}
