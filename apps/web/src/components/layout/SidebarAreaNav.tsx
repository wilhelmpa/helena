import type { View } from '@/lib/api/endpoints/views';
import { useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import { SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar';
import SidebarAreaItem from '@/components/layout/SidebarAreaItem';

// The project's areas under its Tasks entry, each with the boards (saved views) it
// holds, and the button that adds an area.
export default function SidebarAreaNav({
  projectKey,
  onEditView,
  onDeleteView,
}: {
  projectKey: string;
  onEditView?: (view: View) => void;
  onDeleteView?: (view: View) => Promise<void>;
}) {
  const { data: areas = [] } = useViewFoldersQuery(projectKey);
  const { data: views = [] } = useViewsQuery(projectKey);
  if (areas.length === 0) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuSub>
        {areas.map((area) => (
          <SidebarAreaItem
            key={area.id}
            projectKey={projectKey}
            area={area}
            areas={areas}
            allViews={views}
            onEditView={onEditView}
            onDeleteView={onDeleteView}
            views={views
              .filter((view) => view.folderId === area.id)
              .sort((a, b) => a.position - b.position || a.id - b.id)}
          />
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}
