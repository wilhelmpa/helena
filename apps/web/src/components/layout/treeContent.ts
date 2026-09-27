import { Children, Fragment, isValidElement, type ReactNode } from 'react';

export function hasTreeContent(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return typeof child === 'string' && child.length > 0;
    return child.type === Fragment
      ? hasTreeContent((child.props as { children?: ReactNode }).children)
      : true;
  });
}
