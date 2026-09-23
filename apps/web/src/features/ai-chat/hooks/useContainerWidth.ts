'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// The width of a ref'd element, kept live with a ResizeObserver. Used for the layout
// decisions that need a number in JS rather than a CSS container query — whether the
// artifact panel is a sibling or a Sheet overlay, which changes what is in the DOM, not
// just how it is styled.
//
// A layout effect (not a plain one) so the first real measurement lands before the
// browser paints, rather than a tick later: mounted inside the tool panel, this
// content can start out behind a `hidden` ancestor (a tool kept warm while another one
// is the visible one) with no box to measure yet, and a render caught in that in-
// between moment is exactly what callers need to not mistake for "wide enough".
export function useContainerWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
