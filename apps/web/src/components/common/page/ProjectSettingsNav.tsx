'use client';

import { usePathname } from 'next/navigation';
import type { SettingsNavGroup } from '@/hooks/useSettingsNavGroups';
import { SectionNav, type SectionNavItem } from './SectionNav';

// The group label: 12px, font-medium, foreground/70, 32px row — the sidebar's own
// group-label contract (SidebarGroupLabel in components/ui/sidebar.tsx), repeated
// here plainly since this nav sits in the page body, not inside the <Sidebar>
// component itself (its classes read CSS variables only that one provides).
const GROUP_LABEL_CLASS = 'flex h-8 items-center px-2 text-xs font-medium text-foreground/70';

// The project settings sub-navigation (docs/volition-design-helena-ui.md "Eigenes
// Einstellungs-Layout"): grouped, in a second narrow column inside the settings
// pages — see useProjectSettingsNavGroups for what goes in each group. Each group
// renders as its own SectionNav (the same rail component team/account settings
// already use), under a sidebar-style group label.
export default function ProjectSettingsNav({
  groups,
  label,
}: {
  groups: SettingsNavGroup[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="flex w-full flex-col gap-4">
      {groups.map((group) => {
        const sections: SectionNavItem[] = group.items.map((item) => ({
          id: item.key,
          label: item.label,
          icon: item.icon,
          href: item.href,
        }));
        const activeId = sections.find((s) => s.href === pathname)?.id ?? null;
        return (
          <div key={group.key}>
            <div className={GROUP_LABEL_CLASS}>{group.label}</div>
            <SectionNav sections={sections} activeId={activeId} label={group.label} />
          </div>
        );
      })}
    </nav>
  );
}
