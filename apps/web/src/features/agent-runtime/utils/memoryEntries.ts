// The memory files of an agent as people read them. Hermes keeps MEMORY.md and USER.md as
// entries separated by a line holding only "§"; Ava's own runtime keeps plain Markdown. A file
// with "§" lines is shown and edited as a list of entries (the separator never reaches the
// screen), any other as Markdown.

export const MEMORY_SEPARATOR = '§';
// The most the API accepts for one file.
export const MAX_MEMORY_CHARS = 16384;

export function hasEntries(content: string): boolean {
  return content.split(/\r?\n/).some((line) => line.trim() === MEMORY_SEPARATOR);
}

// The entries of a "§" file, each trimmed, empty ones dropped.
export function parseEntries(content: string): string[] {
  return content
    .split(/\r?\n/)
    .reduce<string[][]>(
      (entries, line) => {
        if (line.trim() === MEMORY_SEPARATOR) entries.push([]);
        else entries.at(-1)!.push(line);
        return entries;
      },
      [[]],
    )
    .map((lines) => lines.join('\n').trim())
    .filter(Boolean);
}

// The file for a list of entries: the separator between them, as Hermes wrote it.
export function joinEntries(entries: string[]): string {
  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(`\n${MEMORY_SEPARATOR}\n`);
}

// The lines of a daily note ("- 08:12 Text"): the time, then what was noted.
export function noteLines(content: string): { time: string | null; text: string }[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
      return match ? { time: match[1], text: match[2] } : { time: null, text: line };
    });
}
