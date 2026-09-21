export function authCallbackPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const base = new URL('https://itsaplan.invalid');
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.pathname === '/login') return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}
