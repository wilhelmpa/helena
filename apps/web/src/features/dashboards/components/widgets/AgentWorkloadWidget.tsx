import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentWorkloadQuery } from '../../services/analytics.service';
import { Stack, Text, Table, Th, Tr, Td } from '@/design-system';

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
    <Table stack={false}>
      <thead>
        <Tr>
          <Th>{t('agent')}</Th>
          <Th alignment="end">{t('delegated')}</Th>
          <Th alignment="end">{t('runs')}</Th>
        </Tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <Tr key={a.agentId}>
            <Td className="min-w-0">
              <span className="block truncate">{a.agentName}</span>
            </Td>
            <Td alignment="end" className="tabular-nums">
              {a.delegatedOpen}
            </Td>
            <Td alignment="end" className="tabular-nums">
              <span>
                {a.runsSuccess}/{a.runsTotal}
              </span>
              {a.runsFailed > 0 && (
                <Text as="span" size="xs" tone="danger" className="ml-1">
                  {t('failed', { count: a.runsFailed })}
                </Text>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
