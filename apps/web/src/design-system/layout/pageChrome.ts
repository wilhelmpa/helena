import { createContext, useContext } from 'react';

// Where a page is shown: in the app frame ('page', the default) or inside something that
// already names it ('modal': the agent dialog, Mein Konto, a page of Helena's settings),
// where that heading replaces the page's own title bar.
export type PageChrome = 'page' | 'modal';
export const PageChromeCtx = createContext<PageChrome>('page');
export function usePageChrome(): PageChrome {
  return useContext(PageChromeCtx);
}

// Whether the top bar shows the breadcrumb and the page's title (owner 30.09., 23:10: "Die
// Breadcrumbs können weg ... Breadcrumbs und Titel weg - oder ausblenden, falls wir das wieder
// ändern müssen"). ONE switch for the whole app: `false` hides them (they stay in the page for
// screen readers, the window's title is unchanged) and gives their room to the page's controls;
// `true` brings the breadcrumb and the title back everywhere. Without a title the page is named
// by the sidebar's selected entry or the page's own tab. From 900px up only: on a phone the
// sidebar is out of sight, so the bar keeps naming the page there (shell.css, `data-heading`).
export const PAGE_HEADING_VISIBLE = false;
