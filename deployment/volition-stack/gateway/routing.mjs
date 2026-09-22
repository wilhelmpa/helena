// HTTP and WebSocket requests must resolve the same service and base path.
export function resolveUpstream(route, url) {
  const match = route.paths?.find(path => url === path.prefix || url.startsWith(`${path.prefix}/`) || url.startsWith(`${path.prefix}?`));
  return {
    target: match?.target ?? route.target,
    url: match && match.stripPrefix !== false ? (url.slice(match.prefix.length) || '/') : url,
  };
}
