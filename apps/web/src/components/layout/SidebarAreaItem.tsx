import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { viewPath } from '@/utils/paths';
import { ViewIcon } from '@/utils/viewIcons';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import SidebarAreaMenu from '@/components/layout/SidebarAreaMenu';
import SidebarSavedViewItem from '@/components/layout/SidebarSavedViewItem';

// One area in the sidebar with the boards it holds, always shown (the tree has nothing
// to fold, owner 28.09.).
export default function SidebarAreaItem({
  projectKey,
  area,
  areas,
  views,
  allViews,
  onEditView,
  onDeleteView,
}: {
  projectKey: string;
  area: ViewFolder;
  areas: ViewFolder[];
  views: View[];
  allViews?: View[];
  onEditView?: (view: View) => void;
  onDeleteView?: (view: View) => Promise<void>;
}) {
  const pathname = usePathname();
  const activeViewId = views.find((view) => pathname === viewPath(projectKey, view.id))?.id;

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={false}
        className={activeViewId != null ? 'pe-7 text-foreground hover:bg-transparent' : 'pe-7'}
      >
        <span>{area.name}</span>
      </SidebarMenuSubButton>
      <SidebarAreaMenu projectKey={projectKey} area={area} areas={areas} />
      {views.length > 0 && (
        <SidebarMenuSub className="me-0 pe-0">
          {views.map((view) => (
            <SidebarMenuSubItem key={view.id}>
              {onEditView && onDeleteView ? (
                <SidebarSavedViewItem
                  view={view}
                  views={allViews ?? views}
                  folders={areas}
                  projectKey={projectKey}
                  onEdit={onEditView}
                  onDelete={onDeleteView}
                />
              ) : (
                <SidebarMenuSubButton asChild size="sm" isActive={view.id === activeViewId}>
                  <Link href={viewPath(projectKey, view.id)}>
                    <ViewIcon name={view.icon} />
                    <span>{view.name}</span>
                  </Link>
                </SidebarMenuSubButton>
              )}
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}
