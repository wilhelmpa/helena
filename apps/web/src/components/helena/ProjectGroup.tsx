'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ProjectTag } from './ProjectTag';

export function ProjectGroup({
  projectKey,
  projectName,
  count,
  children,
}: {
  projectKey: string;
  projectName: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        className="flex h-10 w-full items-center gap-2 border-b bg-muted px-4 text-start text-xs font-medium"
        aria-expanded={count > 0 ? open : undefined}
        onClick={() => count > 0 && setOpen(!open)}
      >
        {count > 0 && (
          <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
        <ProjectTag projectKey={projectKey} />
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
      </button>
      {count > 0 && open && children}
    </section>
  );
}
