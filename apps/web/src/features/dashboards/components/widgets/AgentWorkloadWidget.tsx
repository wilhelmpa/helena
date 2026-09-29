import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentWorkloadQuery } from '../../services/analytics.service';
import { Stack, Text } from '@/design-system';

// Per-agent workload: how many open issues each agent is currently delegated and its
// lifetime run outcomes (success over total). Rows are ordered by delegated load. No
// per-widget config; it always shows every agent in the project.
export default function AgentWorkloadWidget({ projectKey }: { projectKey: string }) {
  const t = useTranslations('dashboards.agentWorkload');
  const { data, isLoading } = useAgentWorkloadQuery(projectKey);
  const items = data ?? [];

  if (isLoading) {
    return (
      <Stack gap={2}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </Stack>
    );
  }

  if (items.length === 0) {
    return (
      <Text as="p" size="sm" tone="muted" className="py-4 text-center">
        {t('empty')}
      </Text>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="pb-1.5 font-medium">{t('agent')}</th>
          <th className="pb-1.5 text-right font-medium">{t('delegated')}</th>
          <th className="pb-1.5 text-right font-medium">{t('runs')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {items.map((a) => (
          <tr key={a.agentId}>
            <td className="min-w-0 py-1.5">
              <span className="block truncate">{a.agentName}</span>
            </td>
            <td className="py-1.5 text-right tabular-nums">{a.delegatedOpen}</td>
            <td className="py-1.5 text-right tabular-nums">
              <span>
                {a.runsSuccess}/{a.runsTotal}
              </span>
              {a.runsFailed > 0 && (
                <Text as="span" size="xs" tone="danger" className="ml-1">
                  {t('failed', { count: a.runsFailed })}
                </Text>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
