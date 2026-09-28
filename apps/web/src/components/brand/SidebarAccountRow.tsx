'use client';

import { Settings } from 'lucide-react';
import UserMenu from '@/components/layout/UserMenu';

// The account row and its settings control at the foot of every sidebar.
export default function SidebarAccountRow({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="helena-sidebar-account group-data-[collapsible=icon]:flex-col">
      <UserMenu variant="row" />
      <button
        type="button"
        className="helena-sidebar-settings"
        aria-label="Einstellungen öffnen"
        title="Einstellungen (⌘,)"
        onClick={onSettings}
      >
        <Settings size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
