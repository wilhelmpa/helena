// A description an agent wrote through a tool call sometimes arrives with its line breaks
// escaped: one long line with literal "\n" in it, which reads as a wall of text (owner,
// 28.09.: "Die Beschreibung ist eine unformatierte Textwand"). A text without a single real
// line break but with escaped ones gets real ones; anything else is kept as written.
export function readableDescription(text: string): string {
  if (text.includes('\n') || !text.includes('\\n')) return text;
  return text.replace(/\\r\\n|\\n/g, '\n');
}
