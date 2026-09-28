'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationGoalNode as GoalNode } from '../organizationTree';
import { Box, Inline, Stack, Text } from '@/design-system';

export default function OrganizationGoalNode({ node }: { node: GoalNode }) {
  const t = useTranslations('organization');
  return (
    <Box as="li" padStart={4}>
      <Inline gap={2} className="min-h-7 text-sm">
        <Target className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.goal.title}</span>
        <Text as="span" size="xs" tone="muted" className="shrink-0">
          {t(`statuses.${node.goal.status}`)}
        </Text>
        {(node.goal.progress?.total ?? 0) > 0 && (
          <Text as="span" size="xs" tone="muted" className="shrink-0 tabular-nums">
            {t('goals.progressShort', {
              done: node.goal.progress!.done,
              total: node.goal.progress!.total,
            })}
          </Text>
        )}
      </Inline>
      {node.children.length > 0 && (
        <Stack as="ul" gap={2} padTop={2} className="ms-2 border-s">
          {node.children.map((child) => (
            <OrganizationGoalNode key={child.goal.id} node={child} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
