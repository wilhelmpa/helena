'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

// The width of a ref'd element, kept live with a ResizeObserver. Used for the layout
// decisions that need a number in JS rather than a CSS container query — whether the
// artifact panel is a sibling or a Sheet overlay, which changes what is in the DOM, not
// just how it is styled.
export function useContainerWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
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
