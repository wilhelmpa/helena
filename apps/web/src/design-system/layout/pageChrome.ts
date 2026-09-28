import { createContext, useContext } from 'react';

// Where a page is shown: in the app frame ('page', the default) or inside the settings
// or agent modal ('modal'), where the modal's own section heading replaces the page's
// title bar.
export type PageChrome = 'page' | 'modal';
export const PageChromeCtx = createContext<PageChrome>('page');
export function usePageChrome(): PageChrome {
  return useContext(PageChromeCtx);
}
