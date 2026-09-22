'use client';

import { useEffect, useState } from 'react';
import { ControlPlaneWorkflowPanel } from '@/features/settings/components/workflows/ControlPlaneWorkflowPanel';
import type { OrganizationProject } from '@/lib/api/endpoints/organization';

export default function OrganizationWorkflows({ projects }: { projects: OrganizationProject[] }) {
  const [projectKey, setProjectKey] = useState(projects[0]?.key ?? '');

  useEffect(() => {
    if (!projects.some((project) => project.key === projectKey))
      setProjectKey(projects[0]?.key ?? '');
  }, [projectKey, projects]);

  if (!projectKey)
    return (
      <p className="text-sm text-muted-foreground">Create a project before assigning workflows.</p>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Workflow templates and project bindings</h2>
          <p className="text-sm text-muted-foreground">
            Mastra owns runs, triggers and schedules. Select a project to inspect its binding.
          </p>
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={projectKey}
          onChange={(event) => setProjectKey(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.key}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <ControlPlaneWorkflowPanel projectKey={projectKey} />
    </div>
  );
}
