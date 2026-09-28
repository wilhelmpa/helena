'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { projectTree } from '@/utils/projectTree';
import { projectColor } from '@/utils/projectColor';
import ProjectTreeGroup from './ProjectTreeGroup';
import ProjectTreeItem from './ProjectTreeItem';
import ProjectUngroupDropZone from './ProjectUngroupDropZone';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function SidebarProjectSwitcher({
  projects,
  currentProjectKey,
  onSelectProject,
  onNewProject,
}: {
  projects: Project[];
  currentProjectKey: string | null;
  onSelectProject: (key: string) => void;
  onNewProject: () => void;
}) {
  const t = useTranslations('nav');
  const newProjectT = useTranslations('newProject');
  const project = projects.find((item) => item.key === currentProjectKey);
  const { groups, ungrouped } = projectTree(projects.filter((item) => item.projectRole !== 'home'));
  const color =
    project && project.projectRole !== 'home' ? projectColor(project.key) : projectColor(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const select = (key: string) => {
    setOpen(false);
    onSelectProject(key);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ds-project-switcher"
          aria-label={t('sidebarSwitchProject')}
          style={{ '--ds-project': color } as React.CSSProperties}
        >
          <span className="ds-project-dot" aria-hidden="true" />
          <span>{project && project.projectRole !== 'home' ? project.name : t('sidebarHome')}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-project-switcher
        align="start"
        className="max-h-[70vh] w-64 overflow-y-auto"
      >
        <DropdownMenuItem asChild>
          <Link href="/">
            <span className="ds-menu-dot" style={{ background: projectColor(null) }} />
            {t('sidebarHomeAll')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ul className="space-y-1 px-1">
          {groups.map((group) => (
            <ProjectTreeGroup
              key={group.id}
              group={group}
              groups={groups}
              currentProjectKey={currentProjectKey}
              onSelectProject={select}
              onDragChange={setDragging}
            />
          ))}
        </ul>
        {ungrouped.length > 0 && groups.length > 0 && (
          <DropdownMenuLabel>{t('projects')}</DropdownMenuLabel>
        )}
        <ul className="space-y-1 px-1">
          {ungrouped.map((item) => (
            <ProjectTreeItem
              key={item.key}
              project={item}
              active={item.key === currentProjectKey}
              groups={groups}
              onSelect={select}
              onDragChange={setDragging}
            />
          ))}
          {dragging && groups.length > 0 && <ProjectUngroupDropZone onDragChange={setDragging} />}
        </ul>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewProject}>
          <Plus size={15} />
          {newProjectT('title')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
