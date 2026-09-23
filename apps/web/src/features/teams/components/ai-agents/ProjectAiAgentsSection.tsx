'use client';

import { useShell } from '@/context/shellContext';
import ProjectAiAgentsView from './ProjectAiAgentsView';

// The AI agents page (/project/:projectKey/ai-agents), a top-level nav item. An agent
// created here, or copied from a template, works in this project only, as a specialist
// reporting to its coordinator.
export default function ProjectAiAgentsSection() {
  const { project } = useShell();
  if (!project) return null;
  return <ProjectAiAgentsView teamId={project.project.teamId} projectId={project.project.id} />;
}
