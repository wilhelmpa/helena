'use client';

import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import UserMenu from '@/components/layout/UserMenu';

// The account row at the foot of the sidebar (docs/volition-design-helena-ui.md, owner
// decision 2026-09-23: the main area gets a single-row header, so language, theme and
// the account menu live here). One 32px sidebar row: the account (avatar and name,
// opening the account menu) takes the width, language and theme sit beside it as quiet
// icon buttons — no outlined boxes, the sidebar's own hover fill. In icon mode the
// three stack. Rendered only when the account's headerLayout preference is 'single';
// see AppHeader/GodShell for the 'classic' fallback.
export default function SidebarAccountRow() {
  return (
    <div className="flex items-center gap-0.5 group-data-[collapsible=icon]:flex-col">
      <UserMenu variant="row" />
      <LocaleToggle variant="ghost" />
      <ThemeToggle variant="ghost" />
    </div>
  );
}
