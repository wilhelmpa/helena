const COLORS = [
  'var(--project-trade)',
  'var(--project-verve)',
  'var(--project-vol)',
  'var(--project-color-4)',
  'var(--project-color-5)',
];

export function projectColor(key: string | null) {
  if (!key) return COLORS[2]!;
  if (key.toUpperCase() === 'TRADE') return COLORS[0]!;
  if (key.toUpperCase() === 'VERVE') return COLORS[1]!;
  if (key.toUpperCase() === 'VOL') return COLORS[2]!;
  if (key.toUpperCase() === 'HOME') return COLORS[2]!;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}
