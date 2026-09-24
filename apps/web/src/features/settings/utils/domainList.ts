// A domain as DomainListField.tsx accepts it: lowercase, no scheme, no path, no trailing
// dot. A leading "*." is dropped because a domain already covers its subdomains (same rule
// as the API, apps/api/src/modules/agent-browser-gateway/model.ts). Returns null for a
// value that normalizes to nothing usable.
export function normalizeDomain(raw: string): string | null {
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (domain.startsWith('*.')) domain = domain.slice(2);
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  return domain.length > 0 && domain.length <= 253 ? domain : null;
}
