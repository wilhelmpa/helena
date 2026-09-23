'use client';

import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import UserMenu from '@/components/layout/UserMenu';

// Language, theme and the account menu, moved out of the main-area header into the
// sidebar footer (docs/volition-design-helena-ui.md, owner decision 2026-09-23: the
// main area gets a single-row header; these controls live in the sidebar instead,
// the same place the brand mark and the God-mode entry already are). Rendered only
// when the account's headerLayout preference is 'single' — see AppHeader/GodShell
// for the 'classic' fallback, where they stay in the header.
//
// The icon buttons are already 32px (size-8), the sidebar's own row height, so they
// need no resizing here; they wrap in icon-collapsed mode instead of hiding, since
// unlike a nav row they carry no label to lose.
export default function SidebarUtilityRow() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
      <LocaleToggle />
      <ThemeToggle />
      <UserMenu />
    </div>
  );
}
