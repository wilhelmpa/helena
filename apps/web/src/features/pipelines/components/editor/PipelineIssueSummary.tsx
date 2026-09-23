'use client';

import { useTranslations } from 'next-intl';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { splitIssues } from '../../utils/issueDisplay';
import PipelineIssueList from '../PipelineIssueList';

// Every problem of the draft above the builder. A problem of a step selects it.
export default function PipelineIssueSummary() {
  const t = useTranslations('pipelines.editor');
  const { issues, select } = usePipelineEditor();
  const { blocking, warnings } = splitIssues(issues);
  if (issues.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      {blocking.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-destructive">
            {t('issuesTitle', { count: blocking.length })}
          </p>
          <PipelineIssueList issues={blocking} onSelect={select} />
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('warningsTitle', { count: warnings.length })}</p>
          <p className="text-xs text-muted-foreground">{t('warningsHint')}</p>
          <PipelineIssueList issues={warnings} onSelect={select} />
        </div>
      )}
    </div>
  );
}
