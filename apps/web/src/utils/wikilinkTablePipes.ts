const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

function mapTableRows(source: string, transform: (line: string, index: number) => string) {
  const lines = source.split('\n');
  let row = 0;
  let fence: { mark: string; length: number } | null = null;
  for (let index = 0; index < lines.length - 1; index++) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[index]!);
    if (marker) {
      if (!fence) fence = { mark: marker[1]![0]!, length: marker[1]!.length };
      else if (marker[1]![0] === fence.mark && marker[1]!.length >= fence.length) fence = null;
    }
    if (fence || !TABLE_SEPARATOR.test(lines[index + 1]!)) continue;
    lines[index] = transform(lines[index]!, row++);
    for (let next = index + 2; next < lines.length && lines[next]!.includes('|'); next++) {
      lines[next] = transform(lines[next]!, row++);
      index = next;
    }
  }
  return lines.join('\n');
}

const unescapeAlias = (inner: string) => inner.replace(/\\\|/g, '|');

export function escapeWikilinkTablePipes(source: string) {
  return mapTableRows(source, (line) =>
    line.replace(WIKILINK, (_whole, inner: string) => {
      const escaped = inner.replace(/\|/g, (bar: string, offset: number) => {
        let slashes = 0;
        for (let index = offset - 1; index >= 0 && inner[index] === '\\'; index--) slashes++;
        return slashes % 2 ? bar : `\\${bar}`;
      });
      return `[[${escaped}]]`;
    }),
  );
}

export function restoreWikilinkTablePipes(original: string, serialized: string) {
  const spellings: Array<Array<{ inner: string; written: string }>> = [];
  mapTableRows(original, (line, index) => {
    spellings[index] = [...line.matchAll(WIKILINK)].map(([written, inner]) => ({
      inner: unescapeAlias(inner!),
      written,
    }));
    return line;
  });
  return mapTableRows(serialized, (line, index) => {
    const available = [...(spellings[index] ?? [])];
    return line.replace(WIKILINK, (written, inner: string) => {
      const position = available.findIndex((item) => item.inner === unescapeAlias(inner));
      return position === -1 ? written : available.splice(position, 1)[0]!.written;
    });
  });
}
