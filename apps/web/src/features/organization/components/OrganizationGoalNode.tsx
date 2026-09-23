'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrganizationGoalNode as GoalNode } from '../organizationTree';

export default function OrganizationGoalNode({ node }: { node: GoalNode }) {
  const t = useTranslations('organization');
  return (
    <li className="ps-4">
      <div className="flex items-center gap-2 text-sm">
        <Target className="size-3.5 text-muted-foreground" />
        <span>{node.goal.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t(`statuses.${node.goal.status}`)}
        </span>
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
