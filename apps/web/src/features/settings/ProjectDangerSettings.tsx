'use client';

import { useShell } from '@/context/shellContext';
import ProjectDangerZone from './components/general/ProjectDangerZone';

export default function ProjectDangerSettings() {
  const { project } = useShell();
  return project ? <ProjectDangerZone project={project} /> : null;
}
