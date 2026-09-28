import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import { cn } from '@/lib/utils';
import PipelineIssueList from '../PipelineIssueList';
import { Inline, Text } from '@/design-system';

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
      <Inline gap={2} justify="between" className="min-h-6">
        <Label htmlFor={htmlFor}>{label}</Label>
        {action}
      </Inline>
      {children}
      {hint && (
        <Text as="p" size="xs" tone="muted">
          {hint}
        </Text>
      )}
      <PipelineIssueList issues={issues} />
    </div>
  );
}
