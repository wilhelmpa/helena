import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import { viewPath } from '@/utils/paths';
import { ViewIcon } from '@/utils/viewIcons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import SidebarAreaMenu from '@/components/layout/SidebarAreaMenu';
import SidebarSavedViewItem from '@/components/layout/SidebarSavedViewItem';

// One area in the sidebar, folding out to the boards it holds. It starts open while
// one of its boards is the open page.
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
  const [open, setOpen] = usePersistedBoolean(`sidebar:area:${area.id}`, activeViewId != null);

  return (
    <Collapsible
      asChild
      open={views.length > 0 && open}
      onOpenChange={setOpen}
      className="group/area"
    >
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton
            asChild
            isActive={false}
            className={activeViewId != null ? 'pe-7 text-foreground hover:bg-transparent' : 'pe-7'}
          >
            <button type="button">
              {views.length > 0 && (
                <ChevronRight className="transition-transform group-data-[state=open]/area:rotate-90" />
              )}
              <span>{area.name}</span>
            </button>
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <SidebarAreaMenu projectKey={projectKey} area={area} areas={areas} />
        <CollapsibleContent>
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
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}
