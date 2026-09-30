export function renderDisplayName<T>(value: T, displayName = 'Ava'): T {
  if (typeof value === 'string') return value.replaceAll('{appName}', displayName) as T;
  if (Array.isArray(value)) return value.map((item) => renderDisplayName(item, displayName)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, renderDisplayName(item, displayName)]),
  ) as T;
}
