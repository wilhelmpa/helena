import { createContext, useCallback, useContext } from 'react';
import type { OpenWebLink } from '@/utils/webLinkNavigation';
import { registerWebLinkScope, type WebLinkScope } from '@/utils/webLinkScope';

export const WebLinksContext = createContext<{
  open: OpenWebLink;
  scope: WebLinkScope;
} | null>(null);

export const useWebLinks = () => useContext(WebLinksContext);

// Portal content keeps React context but has different DOM ancestors. Its rendered
// links/editor root register the same scope so capture cannot fall back to Home.
export function useWebLinkScopeRef() {
  const scope = useWebLinks()?.scope;
  return useCallback(
    (element: HTMLElement | null) => {
      registerWebLinkScope(element, scope);
    },
    [scope],
  );
}
