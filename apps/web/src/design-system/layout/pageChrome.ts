import { createContext, useContext } from 'react';

// Where a page is shown: in the app frame ('page', the default) or inside something that
// already names it ('modal': the agent dialog, Mein Konto, a page of Helena's settings),
// where that heading replaces the page's own title bar.
export type PageChrome = 'page' | 'modal';
export const PageChromeCtx = createContext<PageChrome>('page');
export function usePageChrome(): PageChrome {
  return useContext(PageChromeCtx);
}
