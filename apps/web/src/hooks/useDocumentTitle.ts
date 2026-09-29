import { useEffect, type RefObject } from 'react';
import { APP_NAME } from '@/utils/app';
import { useDisplayName } from '@/context/displayName';

// The product name every tab title ends with.

// The words of the header's title (a breadcrumb or a plain name), most specific first:
// "Labels · Einstellungen · E2E". The crumbs are the element's innermost text nodes.
export function headerTitleParts(node: HTMLElement): string[] {
  const leaves = [...node.querySelectorAll<HTMLElement>('a, span')]
    .filter((element) => element.childElementCount === 0)
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
  const parts = leaves.length > 0 ? leaves : [node.textContent?.trim() ?? ''].filter(Boolean);
  return parts.reverse();
}

export function composeDocumentTitle(
  parts: string[],
  lead?: string | null,
  appName = APP_NAME,
): string {
  // With a lead (a task's identifier and title) only the project stays from the crumbs.
  const words = lead ? [lead, parts[parts.length - 1]] : parts;
  return [...words.filter(Boolean), appName].join(' · ');
}

// Keeps the browser tab's title in line with the header's breadcrumb, so tabs and
// history tell pages apart ("E2E-4 QA Aufgabe · E2E · Helena"). `lead` puts a page's
// own name first, where the breadcrumb only has an identifier. The title the page had
// before (the app's generic one) comes back when the header goes.
export function useDocumentTitle(target: RefObject<HTMLElement | null>, lead?: string | null) {
  const appName = useDisplayName();
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const before = document.title;
    const update = () => {
      const title = composeDocumentTitle(headerTitleParts(node), lead, appName);
      if (document.title !== title) document.title = title;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(node, { subtree: true, childList: true, characterData: true });
    // Next writes the route's metadata title into <head> after the first paint (and on
    // every navigation), over this one.
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = before;
    };
  }, [target, lead, appName]);
}
