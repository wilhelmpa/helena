import type { ReactNode } from 'react';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import PipelineIssueList from '../PipelineIssueList';
import { Inline, Stack, Text } from '@/design-system';

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
    <Stack as="section" gap={3} pad={4} className="rounded-md border bg-card">
      <Inline gap={3} justify="between" align="start">
        <div>
          <h2 className="text-md font-medium">{title}</h2>
          {hint && (
            <Text as="p" size="xs" tone="muted">
              {hint}
            </Text>
          )}
        </div>
        {action}
      </Inline>
      {children}
      <PipelineIssueList issues={issues} />
    </Stack>
  );
}
