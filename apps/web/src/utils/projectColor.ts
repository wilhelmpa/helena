const colors = ['#7ee0b8', '#f0997b', '#bdaaff', '#8dc7f3', '#e8cc83'];

export function projectColor(key: string): string {
  if (key.toUpperCase() === 'TRADE') return colors[0]!;
  if (key.toUpperCase() === 'VERVE') return colors[1]!;
  if (key.toUpperCase() === 'VOL') return colors[2]!;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length]!;
}
