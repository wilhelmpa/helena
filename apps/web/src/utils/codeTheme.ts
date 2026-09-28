export type CodeThemeMode = 'dark' | 'light';

export function attachCodeTheme(url: string, mode: CodeThemeMode) {
  if (
    typeof BroadcastChannel === 'undefined' ||
    new URL(url, window.location.href).origin !== window.location.origin
  ) {
    return;
  }
  const channel = new BroadcastChannel('helena-code-theme');
  const send = () => channel.postMessage({ type: 'theme', mode });
  channel.onmessage = (event) => {
    if (event.data?.type === 'ready') send();
  };
  send();
  return () => channel.close();
}
