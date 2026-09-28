export function projectLinkTarget(href: string, currentProjectKey: string | null, origin: string) {
  const url = new URL(href, origin);
  if (url.origin !== origin) return null;
  const match = /^\/project\/([^/?#]+)(?:\/|$)/.exec(url.pathname);
  if (!match) return null;
  const key = decodeURIComponent(match[1]!);
  if (key === currentProjectKey) return null;
  return { href: `${url.pathname}${url.search}${url.hash}`, key };
}
