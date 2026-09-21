import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

// A single sidebar link. Disabled (no target) until a project is selected.
export default function SidebarNavItem({
  href,
  icon: Icon,
  label,
  active,
  disabled,
  badge,
  onClick,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} disabled={disabled} tooltip={label}>
        <Link
          href={disabled ? '#' : href}
          onClick={
            onClick
              ? (event) => {
                  event.preventDefault();
                  if (!disabled) onClick();
                }
              : undefined
          }
        >
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge != null && badge > 0 && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}
