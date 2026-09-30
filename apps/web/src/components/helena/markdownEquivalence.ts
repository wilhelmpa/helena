// Whether the formatted editor writes a text back as it was, for the field that decides between
// "formatted" and "source". The editor writes a blank line between a heading and its list where
// a person wrote none; that changes no word of the text, so blank lines and trailing spaces do
// not count. Any other difference (a marker, an escape, a rewritten line) does: then the text
// opens as source and stays exactly as it is.
export function equivalentMarkdown(original: string, written: string): boolean {
  const lines = (text: string) =>
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '');
  const a = lines(original);
  const b = lines(written);
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
