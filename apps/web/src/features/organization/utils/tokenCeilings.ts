// The largest ceiling the API takes.
const MAX_CEILING = 1_000_000_000_000;

// A ceiling as typed into its field: null for an empty field, which is no ceiling, and
// undefined for anything the API would refuse.
export function parseCeiling(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const ceiling = Number(value);
  return ceiling >= 1 && ceiling <= MAX_CEILING ? ceiling : undefined;
}

// How much of the ceiling is used, as a whole percentage of at most 100, or null
// without a ceiling.
export function usagePercent(used: number, ceiling: number | null): number | null {
  if (ceiling == null) return null;
  return Math.min(100, Math.floor((used / ceiling) * 100));
}
