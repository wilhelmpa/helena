import Link from 'next/link';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import type { SidebarNavSubmenuItem } from '@/components/layout/SidebarNavSubmenu';

// The expanded form of SidebarNavSubmenu. It starts open when the current page is
// one of its items, so a reload keeps the sub-list visible.
export default function SidebarNavSubmenuCollapsible({
  icon: Icon,
  label,
  items,
}: {
  icon: LucideIcon;
  label: string;
  items: SidebarNavSubmenuItem[];
}) {
  const [open, setOpen] = usePersistedBoolean(
    `sidebar:group:${items[0]?.href ?? 'empty'}`,
    items.some((item) => item.active),
  );
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={items.some((i) => i.active)}>
            <Icon />
            <span>{label}</span>
            <ChevronRight className="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.key}>
                <SidebarMenuSubButton asChild isActive={item.active}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
