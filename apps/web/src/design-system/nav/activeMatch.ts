// Which tree row is "the" current one (docs/design-system.md §7: exactly one marking).
// Every row of the sidebar is a candidate with its href; the one that describes the
// current location most specifically wins, and only that row is marked. A row can list
// further paths it stands for (a level-1 row "Aufgaben" also stands for an issue page),
// and it can require that the location carries no extra query (a folder row must not win
// on ?path=… of a subfolder that has its own row).

export type NavLocation = { pathname: string; search: URLSearchParams | string };

export type NavCandidate = {
  id: string;
  href: string;
  // Other paths (no query) this row stands for; matched as a prefix. Weaker than the
  // row's own href.
  also?: string[];
  // The row's own path matches only exactly, never as a prefix of a deeper path.
  exact?: boolean;
  // Query keys that must be absent for the row to match (e.g. 'path' on a folder root).
  without?: string[];
  // Query keys of which at least one must be present (the chat page carries `thread`,
  // `agent` or `new`; its bare address is the dashboard).
  withAny?: string[];
};

function splitHref(href: string): { path: string; query: URLSearchParams } {
  const [path = '', query = ''] = href.split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: new URLSearchParams(query) };
}

// Tiers: the row's own path exactly > its own path as a prefix > an `also` path exactly >
// an `also` path as a prefix. Within a tier the longer (more specific) path wins, and
// every matched query parameter of the href adds to it.
function pathScore(pathname: string, path: string, exact: boolean, own: boolean): number {
  const current = pathname.replace(/\/+$/, '') || '/';
  const base = own ? 2000 : 0;
  if (current === path) return base + 1000 + path.length;
  if (exact || path === '/') return -1;
  return current.startsWith(`${path}/`) ? base + path.length : -1;
}

// The score of one candidate for the location (-1: no match).
export function matchScore(candidate: NavCandidate, location: NavLocation): number {
  const search =
    typeof location.search === 'string' ? new URLSearchParams(location.search) : location.search;
  if (candidate.without?.some((key) => search.has(key))) return -1;
  if (candidate.withAny && !candidate.withAny.some((key) => search.has(key))) return -1;
  const { path, query } = splitHref(candidate.href);
  let best = pathScore(location.pathname, path, candidate.exact ?? false, true);
  if (best >= 0) {
    // Every query parameter of the href must be present with the same value; each one
    // matched makes the row more specific than one without it.
    for (const [key, value] of query) {
      if (search.get(key) !== value) {
        best = -1;
        break;
      }
      best += 100;
    }
  }
  for (const other of candidate.also ?? []) {
    best = Math.max(
      best,
      pathScore(location.pathname, other.replace(/\/+$/, '') || '/', false, false),
    );
  }
  return best;
}

// The id of the one row to mark, or null when none describes the location.
export function pickActive(candidates: NavCandidate[], location: NavLocation): string | null {
  let winner: string | null = null;
  let top = -1;
  for (const candidate of candidates) {
    const score = matchScore(candidate, location);
    if (score > top) {
      top = score;
      winner = candidate.id;
    }
  }
  return top >= 0 ? winner : null;
}
