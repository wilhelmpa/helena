import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import { cn } from '@/lib/utils';
import PipelineIssueList from '../PipelineIssueList';

// A labelled field of the builder with its hint and the problems the API names for it.
export default function PipelineField({
  label,
  htmlFor,
  hint,
  action,
  issues = [],
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  action?: ReactNode;
  issues?: DefinitionIssue[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {action}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <PipelineIssueList issues={issues} />
    </div>
  );
}
