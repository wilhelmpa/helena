'use client';

import { useShell } from '@/context/shellContext';
import ProjectDangerZone from './components/general/ProjectDangerZone';
import { Page } from '@/design-system';

export default function ProjectDangerSettings() {
  const { project } = useShell();
  return <Page>{project ? <ProjectDangerZone project={project} /> : null}</Page>;
}
