export function isAllowedResultKind(
  kind: string,
  requestedResources: ReadonlySet<string>,
): boolean {
  return requestedResources.has(kind) && !/^board:[0-9]+:files$/.test(kind);
}

export function sanitizeResourceUrl(kind: string, value: string): string | null {
  if (value.length > 2000) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    // These two UI deep links require one non-secret path parameter. All other
    // query fields are discarded so access tokens cannot be persisted by mistake.
    const board = /^board:([1-9][0-9]{0,9})$/.exec(kind);
    const queryKey =
      kind === 'workspace' || board
        ? 'folder'
        : kind === 'files'
          ? 'dir'
          : kind === 'terminal'
            ? 'arg'
            : null;
    const deepPath = queryKey ? url.searchParams.get(queryKey) : null;
    const browserRoute =
      kind === 'browser'
        ? /^\/browser\/projects\/([a-z0-9][a-z0-9-]{0,31})\/vnc\.html$/.exec(url.pathname)
        : null;
    const browserPath = browserRoute ? url.searchParams.get('path') : null;
    const validBrowserPath =
      browserRoute !== null &&
      browserPath === `browser/projects/${browserRoute[1]}/websockify` &&
      url.searchParams.get('autoconnect') === '1' &&
      url.searchParams.get('resize') === 'remote';
    url.search = '';
    const validDeepPath = board
      ? new RegExp(`^/projects/[a-z0-9][a-z0-9_-]{0,127}/boards/board-${board[1]}$`, 'i').test(
          deepPath ?? '',
        )
      : kind === 'workspace'
        ? /^\/projects\/[a-z0-9][a-z0-9_-]{0,127}$/i.test(deepPath ?? '')
        : kind === 'files'
          ? /^\/Projects\/[a-z0-9][a-z0-9_-]{0,127}$/i.test(deepPath ?? '')
          : kind === 'terminal'
            ? /^[a-z0-9][a-z0-9_-]{0,63}$/.test(deepPath ?? '')
            : false;
    if (queryKey && deepPath && validDeepPath) {
      url.searchParams.set(queryKey, deepPath);
    }
    if (validBrowserPath) {
      url.searchParams.set('autoconnect', '1');
      url.searchParams.set('resize', 'remote');
      url.searchParams.set('path', browserPath);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
