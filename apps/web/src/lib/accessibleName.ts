import { Children, Fragment, isValidElement, type ReactNode } from 'react';

// Helpers that give an icon-only control an accessible name from the words it already
// shows elsewhere (its tooltip, its title), so a screen reader or an automation never
// meets an empty button. Only the static element tree is read: strings and plain DOM
// elements count as text, a component (an icon) does not.

type ElementProps = { children?: ReactNode; 'aria-label'?: unknown; 'aria-labelledby'?: unknown };

// The words a node renders directly, joined with single spaces ('' when there are none).
export function nodeText(node: ReactNode): string {
  const parts: string[] = [];
  const walk = (n: ReactNode) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      parts.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (isValidElement<ElementProps>(n) && (typeof n.type === 'string' || n.type === Fragment)) {
      Children.forEach(n.props.children, walk);
    }
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Whether a control (an element, e.g. the child of a Radix `asChild` trigger) already
// carries a name: its own aria-label, or words among its children.
export function elementHasName(element: ReactNode): boolean {
  if (!isValidElement<ElementProps>(element)) return nodeText(element) !== '';
  if (element.props['aria-label'] != null || element.props['aria-labelledby'] != null) return true;
  return nodeText(element.props.children) !== '';
}
