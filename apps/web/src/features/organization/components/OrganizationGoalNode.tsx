'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationGoalNode as GoalNode } from '../organizationTree';

export default function OrganizationGoalNode({ node }: { node: GoalNode }) {
  const t = useTranslations('organization');
  return (
    <li className="ps-4">
      <div className="flex min-h-7 items-center gap-2 text-sm">
        <Target className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.goal.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t(`statuses.${node.goal.status}`)}
        </span>
        {(node.goal.progress?.total ?? 0) > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t('goals.progressShort', {
              done: node.goal.progress!.done,
              total: node.goal.progress!.total,
            })}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ms-2 space-y-2 border-s pt-2">
          {node.children.map((child) => (
            <OrganizationGoalNode key={child.goal.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
