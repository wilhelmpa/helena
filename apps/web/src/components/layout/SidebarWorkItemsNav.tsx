'use client';

import Link from 'next/link';
import { ChevronRight, Folder, List, SquareKanban } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePersistedBoolean } from '@/hooks/usePersistedBoolean';
import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { projectPath, viewPath } from '@/utils/paths';
import { viewIcon } from '@/utils/viewIcons';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import { activeSidebarView, organizeSidebarViews } from './sidebarWorkItems';

function ViewLink({
  projectKey,
  view,
  active,
}: {
  projectKey: string;
  view: View;
  active: boolean;
}) {
  const layout = (view.display as { layout?: string } | null)?.layout;
  const Icon = view.icon ? viewIcon(view.icon) : layout === 'kanban' ? SquareKanban : List;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <Link href={viewPath(projectKey, view.id)}>
          <Icon />
          <span>{view.name}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function ViewFolderGroup({
  projectKey,
  folder,
  views,
  pathname,
}: {
  projectKey: string;
  folder: ViewFolder;
  views: View[];
  pathname: string;
}) {
  const active = views.some((view) => pathname === viewPath(projectKey, view.id));
  const [open, setOpen] = usePersistedBoolean(
    `sidebar:view-folder:${projectKey}:${folder.id}`,
    active,
  );
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/view-folder">
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton asChild isActive={active}>
            <button type="button" title={folder.name}>
              <Folder />
              <span className="min-w-0 flex-1 truncate text-start">{folder.name}</span>
              <ChevronRight className="ms-auto transition-transform group-data-[state=open]/view-folder:rotate-90" />
            </button>
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ms-4 flex min-w-0 flex-col gap-1 border-l border-sidebar-border ps-2 pt-1">
            {views.map((view) => (
              <ViewLink
                key={view.id}
                projectKey={projectKey}
                view={view}
                active={pathname === viewPath(projectKey, view.id)}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}

export default function SidebarWorkItemsNav({
  projectKey,
  label,
  allLabel,
  pathname,
  onWorkItems,
  views,
  folders,
}: {
  projectKey: string;
  label: string;
  allLabel: string;
  pathname: string;
  onWorkItems: boolean;
  views: View[];
  folders: ViewFolder[];
}) {
  const { state, isMobile } = useSidebar();
  const organized = organizeSidebarViews(views, folders);
  const activeView = activeSidebarView(projectKey, pathname, views);
  const [open, setOpen] = usePersistedBoolean(`sidebar:work-items:${projectKey}`, onWorkItems);

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarNavItem
        href={projectPath(projectKey)}
        icon={SquareKanban}
        label={label}
        active={onWorkItems}
        disabled={false}
      />
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/work-items">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onWorkItems}>
            <SquareKanban />
            <span>{label}</span>
            <ChevronRight className="ms-auto transition-transform group-data-[state=open]/work-items:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={onWorkItems && !activeView}>
                <Link href={projectPath(projectKey)}>
                  <SquareKanban />
                  <span>{allLabel}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {organized.root.map((view) => (
              <ViewLink
                key={view.id}
                projectKey={projectKey}
                view={view}
                active={pathname === viewPath(projectKey, view.id)}
              />
            ))}
            {organized.folders.map(({ folder, views: folderViews }) => (
              <ViewFolderGroup
                key={folder.id}
                projectKey={projectKey}
                folder={folder}
                views={folderViews}
                pathname={pathname}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
