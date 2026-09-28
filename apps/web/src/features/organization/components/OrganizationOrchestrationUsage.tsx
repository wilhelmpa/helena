'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { compactTokens } from '@/utils/agentUsage';
import { formatDate } from '@/utils/dates';
import { revScope } from '@/utils/revScopes';
import { useAgentUsageQuery } from '../services/organization.service';
import { Stack, Text } from '@/design-system';

// The tokens the project's agent runs used this month, and per task closed this month
// that agents worked on.
export default function OrganizationOrchestrationUsage({ projectKey }: { projectKey: string }) {
  const t = useTranslations('organization.orchestration.usage');
  const { project } = useShell();
  const usage = useAgentUsageQuery(projectKey);
  useLiveRefresh({
    scope: project ? revScope.agentRuns(project.project.id) : null,
    targets: [qk.agentUsage(projectKey)],
  });
  const data = usage.data;

  return (
    <Stack as="section" gap={3} pad={4} className="rounded-md border bg-card">
      <div>
        <h2 className="text-md font-medium">{t('title')}</h2>
        {data && (
          <Text as="p" size="xs" tone="muted">
            {t('description', { since: formatDate(data.since.slice(0, 10)) })}
          </Text>
        )}
      </div>
      {usage.isPending ? (
        <Text as="p" size="sm" tone="muted">
          {t('loading')}
        </Text>
      ) : !data ? (
        <Text as="p" size="sm" tone="muted">
          {t('unavailable')}
        </Text>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('month')}</dt>
            <dd className="text-md font-semibold" dir="ltr">
              {compactTokens(data.inputTokens + data.outputTokens)}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t('split', {
                input: compactTokens(data.inputTokens),
                output: compactTokens(data.outputTokens),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('perClosedTask')}</dt>
            <dd className="text-md font-semibold" dir="ltr">
              {data.tokensPerClosedTask == null ? '—' : compactTokens(data.tokensPerClosedTask)}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t('closedTasks', { count: data.closedTasks })}
            </dd>
          </div>
        </dl>
      )}
    </Stack>
  );
}
