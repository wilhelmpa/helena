'use client';

import { useTranslations } from 'next-intl';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { splitIssues } from '../../utils/issueDisplay';
import PipelineIssueList from '../PipelineIssueList';
import { Stack, Text } from '@/design-system';

// Every problem of the draft above the builder. A problem of a step selects it.
export default function PipelineIssueSummary() {
  const t = useTranslations('pipelines.editor');
  const { issues, select } = usePipelineEditor();
  const { blocking, warnings } = splitIssues(issues);
  if (issues.length === 0) return null;

  return (
    <Stack gap={3} pad={4} className="rounded-md border bg-card">
      {blocking.length > 0 && (
        <Stack gap={2}>
          <Text as="p" size="sm" tone="danger" className="font-medium">
            {t('issuesTitle', { count: blocking.length })}
          </Text>
          <PipelineIssueList issues={blocking} onSelect={select} />
        </Stack>
      )}
      {warnings.length > 0 && (
        <Stack gap={2}>
          <Text as="p" size="sm" className="font-medium">
            {t('warningsTitle', { count: warnings.length })}
          </Text>
          <Text as="p" size="xs" tone="muted">
            {t('warningsHint')}
          </Text>
          <PipelineIssueList issues={warnings} onSelect={select} />
        </Stack>
      )}
    </Stack>
  );
}
