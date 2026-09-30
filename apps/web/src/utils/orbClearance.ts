'use client';

import { useEffect } from 'react';

// The desktop orb floats over the bottom right corner of the page (owner 30.09.: "Orb verdeckt
// nichts"). A page that scrolls under it must be able to scroll its last row clear of it: every
// scroller that reaches the orb's corner is marked, and the design system gives a marked scroller
// an empty end of the orb's height (`[data-orb-clear]::after`, shell.css, --orb-clear). One place,
// for every page, list and table - no page pads itself for the orb.
export const ORB_CLEAR_ATTRIBUTE = 'data-orb-clear';
export const ORB_CLEAR_QUERY = '(min-width: 900px)';
// The height the end gets: the orb (64px) + its distance to the edge (24px) + air. It is
// --orb-clear in shell.css.
export const ORB_CLEAR_PX = 96;

type Box = { left: number; top: number; right: number; bottom: number };
type Scroller = Pick<Element, 'hasAttribute'> & {
  scrollHeight: number;
  clientHeight: number;
};

// The points of the orb that count: a grid over its box, a little inside (a scroller may reach
// only a corner of it, like a board column that ends just under it).
export function orbPoints(box: Box, steps = 4): Array<[number, number]> {
  const inset = 4;
  const points: Array<[number, number]> = [];
  for (let row = 0; row < steps; row++)
    for (let column = 0; column < steps; column++)
      points.push([
        box.left + inset + ((box.right - box.left - 2 * inset) * column) / (steps - 1),
        box.top + inset + ((box.bottom - box.top - 2 * inset) * row) / (steps - 1),
      ]);
  return points;
}

// Which of the elements under the orb are scrollers that overflow. A marked scroller carries its
// empty end, which is not content: it overflows when it does so without it.
export function overflowsUnderOrb<T extends Scroller>(
  stack: T[],
  scrolls: (element: T) => boolean,
  tail = ORB_CLEAR_PX,
): T[] {
  return stack.filter((element) => {
    if (!scrolls(element)) return false;
    const own = element.hasAttribute(ORB_CLEAR_ATTRIBUTE) ? tail : 0;
    return element.scrollHeight - own > element.clientHeight + 1;
  });
}

function scrollsVertically(element: Element): boolean {
  return /(auto|scroll)/.test(getComputedStyle(element).overflowY);
}

// Marks the scrollers under the orb and unmarks the ones that no longer are. Returns nothing:
// the attribute is the state.
export function markOrbScrollers(main: Element, dock: Element): void {
  const marked = new Set<Element>();
  for (const [x, y] of orbPoints(dock.getBoundingClientRect())) {
    const stack = document.elementsFromPoint(x, y).filter((element) => main.contains(element));
    for (const element of overflowsUnderOrb(stack, scrollsVertically)) marked.add(element);
  }
  for (const element of main.querySelectorAll(`[${ORB_CLEAR_ATTRIBUTE}]`))
    if (!marked.has(element)) element.removeAttribute(ORB_CLEAR_ATTRIBUTE);
  for (const element of marked) element.setAttribute(ORB_CLEAR_ATTRIBUTE, '');
}

// Keeps the marks right while the orb is on the screen: when the page changes (a route, content
// that arrives or leaves, a resize).
export function useOrbClearance(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const query = window.matchMedia(ORB_CLEAR_QUERY);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const dock = document.querySelector('.ds-dock');
      const main = document.querySelector('.ds-main');
      if (!dock || !main) return;
      if (!query.matches) {
        for (const element of main.querySelectorAll(`[${ORB_CLEAR_ATTRIBUTE}]`))
          element.removeAttribute(ORB_CLEAR_ATTRIBUTE);
        return;
      }
      markOrbScrollers(main, dock);
    };
    // Throttled: a streaming chat changes the DOM many times a second.
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(run);
      }, 120);
    };
    schedule();
    const main = document.querySelector('.ds-main');
    const observer = new MutationObserver(schedule);
    if (main) observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    query.addEventListener('change', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      query.removeEventListener('change', schedule);
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
      document
        .querySelectorAll(`[${ORB_CLEAR_ATTRIBUTE}]`)
        .forEach((element) => element.removeAttribute(ORB_CLEAR_ATTRIBUTE));
    };
  }, [active]);
}
