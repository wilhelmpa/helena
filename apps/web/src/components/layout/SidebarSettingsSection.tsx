import type { LucideIcon } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

export interface SidebarSettingsItem {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
}

export default function SidebarSettingsSection({
  label,
  items,
  disabled,
}: {
  label?: string;
  items: SidebarSettingsItem[];
  disabled: boolean;
}) {
  if (!items.length) return null;

  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarNavItem
              key={item.key}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={item.active}
              disabled={disabled}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
