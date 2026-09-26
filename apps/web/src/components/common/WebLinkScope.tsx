import { useCallback, useContext, type ReactNode } from 'react';
import { WebLinksContext } from '@/context/webLinks';
import { registerWebLinkScope, type WebLinkScope as Scope } from '@/utils/webLinkScope';

// null means Home; undefined explicitly means unresolved, never the surrounding project.
export default function WebLinkScope({
  projectKey,
  children,
}: {
  projectKey: Scope;
  children: ReactNode;
}) {
  const links = useContext(WebLinksContext);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      registerWebLinkScope(element, projectKey);
    },
    [projectKey],
  );
  return (
    <WebLinksContext.Provider value={links ? { ...links, scope: projectKey } : null}>
      <div ref={ref} className="contents">
        {children}
      </div>
    </WebLinksContext.Provider>
  );
}
