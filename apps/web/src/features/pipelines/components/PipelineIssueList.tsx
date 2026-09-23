'use client';

import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import { cn } from '@/lib/utils';
import { usePipelineLabels } from '../hooks/usePipelineLabels';
import { isProjectIssue, issueKey } from '../utils/issueDisplay';

// Problems in words. A problem of the definition blocks saving; a problem in the project
// only keeps the workflow from being enabled there, so it reads as a warning. With
// `onSelect`, a problem of a step selects that step.
export default function PipelineIssueList({
  issues,
  onSelect,
  className,
}: {
  issues: DefinitionIssue[];
  onSelect?: (stepId: string) => void;
  className?: string;
}) {
  const labels = usePipelineLabels();
  if (issues.length === 0) return null;

  return (
    <ul className={cn('space-y-1 text-xs', className)}>
      {issues.map((issue, index) => {
        const warning = isProjectIssue(issue);
        const Icon = warning ? TriangleAlert : CircleAlert;
        const text = labels.issue(issue);
        const content = (
          <>
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span>{text}</span>
          </>
        );
        const tone = warning ? 'text-muted-foreground' : 'text-destructive';
        return (
          <li key={issueKey(issue, index)}>
            {onSelect && issue.stepId ? (
              <button
                type="button"
                className={cn('flex gap-1.5 text-start hover:underline', tone)}
                onClick={() => onSelect(issue.stepId!)}
              >
                {content}
              </button>
            ) : (
              <span className={cn('flex gap-1.5', tone)}>{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
