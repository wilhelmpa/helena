// A link into another project than the current one (docs/ui-system.md §8: only the project
// switcher changes the project). `issue` is the task's number when the link names a task,
// which then opens in the task overlay over the current page; other pages open a sheet that
// offers "Im Projekt öffnen". Helena's pages refuse to be framed (X-Frame-Options DENY,
// frame-ancestors 'none'), so no preview ever embeds one.
export type ProjectLinkTarget = { href: string; key: string; issue?: number };

export function projectLinkTarget(
  href: string,
  currentProjectKey: string | null,
  origin: string,
): ProjectLinkTarget | null {
  const url = new URL(href, origin);
  if (url.origin !== origin) return null;
  const match = /^\/project\/([^/?#]+)(?:\/|$)/.exec(url.pathname);
  if (!match) return null;
  const key = decodeURIComponent(match[1]!);
  if (key === currentProjectKey) return null;
  const target: ProjectLinkTarget = { href: `${url.pathname}${url.search}${url.hash}`, key };
  const issue = /^\/project\/[^/?#]+\/issue\/(\d+)\/?$/.exec(url.pathname);
  if (issue) target.issue = Number(issue[1]);
  return target;
}
