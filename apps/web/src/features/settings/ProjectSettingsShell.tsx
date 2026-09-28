'use client';

import type { ReactNode } from 'react';

// The chrome every /project/:projectKey/settings/* page shares: the grouped
// sub-navigation in a second, narrow column (docs/volition-design-helena-ui.md
// "Eigenes Einstellungs-Layout"), the page itself beside it. Below lg the rail becomes
// one dropdown at the start of the page's header row (SettingsToolbar), so the page
// starts with its own content and there is no second row.
export default function ProjectSettingsShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
