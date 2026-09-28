'use client';

import { Settings, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { godPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import UserMenu from '@/components/layout/UserMenu';

// The account row at the foot of the sidebar (docs/volition-design-helena-ui.md, owner
// decision 2026-09-23: the main area gets a single-row header, so language, theme and
// the account menu live here). One 32px sidebar row: the account (avatar and name,
// opening the account menu) takes the width, language and theme sit beside it as quiet
// icon buttons — no outlined boxes, the sidebar's own hover fill. In icon mode the
// three stack. Rendered only when the account's headerLayout preference is 'single';
// see AppHeader/GodShell for the 'classic' fallback.
export default function SidebarAccountRow({ onSettings }: { onSettings: () => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  return (
    <div className="helena-sidebar-account group-data-[collapsible=icon]:flex-col">
      <UserMenu variant="row" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="helena-sidebar-settings"
            aria-label="Einstellungen"
            title="Einstellungen (⌘,)"
          >
            <Settings size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <DropdownMenuItem onSelect={onSettings}>
            <Settings />
            {'Einstellungen'}
          </DropdownMenuItem>
          {session?.user.role === 'god' && (
            <DropdownMenuItem onSelect={() => router.push(godPath(GOD_SECTIONS[0]!.slug))}>
              <Shield />
              {'Administrator'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
