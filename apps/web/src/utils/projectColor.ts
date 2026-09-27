const COLORS = ['#7ee0b8', '#f0997b', '#bdaaff', '#8dc7f3', '#e8cc83'];

export function projectColor(key: string | null) {
  if (!key) return '#bdaaff';
  if (key.toUpperCase() === 'TRADE') return '#7ee0b8';
  if (key.toUpperCase() === 'VERVE') return '#f0997b';
  if (key.toUpperCase() === 'HOME') return '#bdaaff';
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}
