// The entities of a fact: the agent names them itself (`entities` of fact_store add), and the
// text adds what stands out as a name. German capitalises every noun, so a single capitalised
// word is not taken for a name; what is: several capitalised words in a row ("Patrick
// Wilhelm"), quoted terms, task keys (VOL-12), @mentions and #tags, words with capitals or
// digits inside (Qwen3.8, OpenClaw, API).

const PATTERNS = [
  /\b(\p{Lu}[\p{Ll}\d]+(?:\s+\p{Lu}[\p{Ll}\d]+)+)\b/gu,
  // Capitalised compounds with a hyphen (Deploy-Tag, E-Mail-Konto).
  /\b(\p{Lu}[\p{L}\d]*(?:-[\p{L}\d]+)+)\b/gu,
  /"([^"\n]{2,60})"/g,
  /„([^“\n]{2,60})“/g,
  /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g,
  /(?:^|\s)[@#]([\p{L}\d_.-]{2,40})/gu,
  /\b(\p{L}*[\p{Ll}]\p{Lu}[\p{L}\d.]*|\p{L}+\d[\p{L}\d.]*|[A-Z]{2,10})\b/gu,
];

const STOP = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'ok', 'ja', 'nein']);
// Words that open a sentence or a noun phrase and are no part of a name.
const LEADING =
  /^(der|die|das|den|dem|des|ein|eine|einer|einen|einem|eines|kein|keine|mein|meine|dein|unser|unsere|jeder|jede|jedes|dieser|diese|dieses|the|a|an|this|that|our|my)\s+/i;

export function extractEntities(text: string, given: string[] = []): string[] {
  const found: string[] = [...given];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  const unique = new Map<string, string>();
  for (const raw of found) {
    let name = raw.trim().replace(/[.,;:]+$/, '');
    // "Der Owner" is the owner; a single capitalised word left over is no name (German
    // capitalises every noun), unless it was given or has capitals or digits inside.
    if (LEADING.test(name)) {
      name = name.replace(LEADING, '');
      if (!/\s/.test(name) && !given.includes(name) && !/\p{Ll}\p{Lu}|\d|-/u.test(name)) continue;
    }
    if (name.length < 2 || name.length > 80 || STOP.has(name.toLowerCase())) continue;
    if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].slice(0, 12);
}
