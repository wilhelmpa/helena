import { runtimeEnv } from './runtimeEnv';
import { isAuthenticationLink, webLinkScope, type WebLinkScope } from './webLinkScope';

export type OpenWebLink = (url: string, scope: WebLinkScope) => void;
const REQUEST = 'helena:open-web-link';

export function webLinkKind(href: string, appUrl: string): 'web' | 'native' | 'unsafe' {
  try {
    const url = new URL(href, appUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.username || url.password) return 'unsafe';
      const appOrigins = typeof window === 'undefined' ? [] : (runtimeEnv().appOrigins ?? []);
      return url.origin === new URL(appUrl).origin || appOrigins.includes(url.origin)
        ? 'native'
        : 'web';
    }
    return ['mailto:', 'tel:', 'blob:'].includes(url.protocol) ? 'native' : 'unsafe';
  } catch {
    return 'unsafe';
  }
}

// Editor keyboard selection may point at an anchor while focus stays on the editor.
// Dispatch from that real anchor so its registered source scope is retained.
export function requestWebLink(link: HTMLAnchorElement): boolean {
  const EventType = link.ownerDocument.defaultView?.Event ?? Event;
  return !link.dispatchEvent(new EventType(REQUEST, { bubbles: true, cancelable: true }));
}

export function installWebLinkNavigation(
  doc: Document,
  open: OpenWebLink,
  fallbackScope: () => WebLinkScope,
  appUrl: string,
): () => void {
  function activate(event: Event) {
    if (event.defaultPrevented) return;
    const mouse = event as MouseEvent;
    if (event.type === 'click' && mouse.button !== 0) return;
    if (event.type === 'auxclick' && mouse.button !== 1) return;
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Enter') return;
    // Avoid instanceof Element: a sandboxed mail frame has its own DOM constructors.
    const target = event.target as Element | null;
    const link = target?.closest?.<HTMLAnchorElement>('a[href]');
    if (!link || isAuthenticationLink(link)) return;
    let href = link.getAttribute('href')!;
    try {
      href = new URL(href, link.baseURI).href;
    } catch {
      // The classifier below refuses malformed addresses.
    }
    // App files are same-origin or blob/data downloads. A foreign web page can
    // forge download in markdown; browsers may ignore it for cross-origin links.
    if (link.hasAttribute('download') && /^data:/i.test(href)) return;
    if (
      event.type === 'click' &&
      link.closest('[contenteditable="true"]') &&
      !mouse.ctrlKey &&
      !mouse.metaKey
    )
      return;
    const kind = webLinkKind(href, appUrl);
    if (kind === 'native') return;
    event.preventDefault();
    event.stopPropagation();
    if (kind === 'web') open(href, webLinkScope(link, fallbackScope()));
  }
  const types = ['click', 'auxclick', 'keydown', REQUEST];
  for (const type of types) doc.addEventListener(type, activate, true);
  return () => {
    for (const type of types) doc.removeEventListener(type, activate, true);
  };
}
