// The entities of a fact: the agent names them itself (`entities` of fact_store add), and the
// text adds what stands out as a name. German capitalises every noun, so a single capitalised
// word is not taken for a name; what is: several capitalised words in a row ("Patrick
// Wilhelm"), quoted terms, task keys (VOL-12), @mentions and #tags, words with capitals or
// digits inside (Qwen3.8, OpenClaw, API).

const PATTERNS = [
  /\b(\p{Lu}[\p{Ll}\d]+(?:\s+\p{Lu}[\p{Ll}\d]+)+)\b/gu,
  /"([^"\n]{2,60})"/g,
  /„([^“\n]{2,60})“/g,
  /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g,
  /(?:^|\s)[@#]([\p{L}\d_.-]{2,40})/gu,
  /\b(\p{L}*[\p{Ll}]\p{Lu}[\p{L}\d.]*|\p{L}+\d[\p{L}\d.]*|[A-Z]{2,10})\b/gu,
];

const STOP = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'ok', 'ja', 'nein']);

export function extractEntities(text: string, given: string[] = []): string[] {
  const found: string[] = [...given];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  const unique = new Map<string, string>();
  for (const raw of found) {
    const name = raw.trim().replace(/[.,;:]+$/, '');
    if (name.length < 2 || name.length > 80 || STOP.has(name.toLowerCase())) continue;
    if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].slice(0, 12);
}
