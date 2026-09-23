// Parses a settings textarea holding "one domain per line" into the list the API
// call sends: trimmed, non-empty lines with case-insensitive duplicates dropped
// (keeping the first spelling), in the order they first appear. This is only for
// the count shown while typing and for what gets submitted — the API is what
// actually validates and canonicalizes each domain.
export function parseDomainList(text: string): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const line of text.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    domains.push(value);
  }
  return domains;
}
