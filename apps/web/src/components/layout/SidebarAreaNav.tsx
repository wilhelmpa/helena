import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useCreateViewFolder, useViewFoldersQuery, useViewsQuery } from '@/services/views.service';
import {
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import SidebarAreaItem from '@/components/layout/SidebarAreaItem';

// The project's areas under its Tasks entry, each with the boards (saved views) it
// holds, and the button that adds an area.
export default function SidebarAreaNav({ projectKey }: { projectKey: string }) {
  const t = useTranslations('views');
  const { can } = usePermissions();
  const { data: areas = [] } = useViewFoldersQuery(projectKey);
  const { data: views = [] } = useViewsQuery(projectKey);
  const createArea = useCreateViewFolder(projectKey);
  const canCreate = can('views', 'create');
  const [creating, setCreating] = useState(false);

  if (areas.length === 0 && !canCreate) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuSub>
        {areas.map((area) => (
          <SidebarAreaItem
            key={area.id}
            projectKey={projectKey}
            area={area}
            views={views
              .filter((view) => view.folderId === area.id)
              .sort((a, b) => a.position - b.position || a.id - b.id)}
          />
        ))}
        {canCreate && (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton asChild size="sm" className="text-muted-foreground">
              <button type="button" onClick={() => setCreating(true)}>
                <Plus />
                <span>{t('newFolder')}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )}
      </SidebarMenuSub>
      {creating && (
        <NameDialog
          title={t('newFolder')}
          description={t('newFolderDescription')}
          label={t('folderNamePrompt')}
          submitLabel={t('create')}
          onSubmit={(name) => createArea.mutateAsync(name)}
          onClose={() => setCreating(false)}
        />
      )}
    </SidebarMenuItem>
  );
}
