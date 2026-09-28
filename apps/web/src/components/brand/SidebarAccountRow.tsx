'use client';

import UserMenu from '@/components/layout/UserMenu';

// The account row at the foot of the sidebar: the avatar and name open the account menu —
// Mein Konto (a small modal), language, theme, sign out. Settings are no button here:
// they are the "Einstellungen" entry of the sidebar, in a project and in Helena
// (docs/einstellungen-struktur.md, „Endgültig“).
export default function SidebarAccountRow() {
  return (
    <div className="ds-sidebar-account">
      <UserMenu variant="row" />
    </div>
  );
}
