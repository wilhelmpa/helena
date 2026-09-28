import type { ElementType, ReactNode } from 'react';

// The shared host for menus, selects, popovers and tooltips. Radix positions
// their content relative to the viewport and mounts it outside clipped panels.
export default function OverlayPortal({
  as: Portal,
  children,
}: {
  as: ElementType;
  children: ReactNode;
}) {
  return (
    <Portal container={typeof document === 'undefined' ? undefined : document.body}>
      {children}
    </Portal>
  );
}
