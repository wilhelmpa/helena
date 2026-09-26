// Only trusted React refs register scopes and authentication links. Attributes in
// markdown or mail HTML cannot impersonate a project or opt out of navigation.
export type WebLinkScope = string | null | undefined;
const scopes = new WeakMap<Element, WebLinkScope>();
const authenticationLinks = new WeakSet<Element>();

export function registerWebLinkScope(element: Element | null, scope: WebLinkScope): void {
  if (element) scopes.set(element, scope);
}

export function webLinkScope(element: Element | null, fallback: WebLinkScope): WebLinkScope {
  for (let current = element; current; current = current.parentElement) {
    if (scopes.has(current)) return scopes.get(current);
  }
  return fallback;
}

// Only the concrete OAuth/device-pairing launch anchor gets this exemption.
export function authenticationLinkRef(element: HTMLAnchorElement | null): void {
  if (element) authenticationLinks.add(element);
}

export const isAuthenticationLink = (element: Element): boolean => authenticationLinks.has(element);
