import type { ReactNode } from 'react';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import PipelineIssueList from '../PipelineIssueList';

// A card of the builder: the trigger, the roles, the steps.
export default function PipelineCard({
  title,
  hint,
  action,
  issues = [],
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  issues?: DefinitionIssue[];
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
      <PipelineIssueList issues={issues} />
    </section>
  );
}
