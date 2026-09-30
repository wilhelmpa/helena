import type { ReactNode } from 'react';

// The square that carries a row's symbol (a login, a tool, a skill, a connection): 32px, the
// inset surface, radius 8, no frame. One tile for every list row that has an icon.
export function IconTile({ children }: { children: ReactNode }) {
  return <span className="ds-icon-tile">{children}</span>;
}
