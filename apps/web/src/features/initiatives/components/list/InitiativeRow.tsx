import Link from 'next/link';
import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Assignee } from '@/lib/api/endpoints/projects';
import type { Initiative } from '@/lib/api/endpoints/initiatives';
import { initiativePath } from '@/utils/paths';
import { formatShortDate } from '@/utils/dates';
import { progressPercent } from '@/utils/progress';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { PriorityIcon } from '@/features/issue/components/shared/IssueIcons';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { STATUS_META } from '@/utils/initiativeMeta';
import HealthBadge from '../shared/HealthBadge';

// One goal of the list: the whole row opens the goal. Left its status dot, the title and a
// line of detail (who owns it, when it is due, its priority); right the progress of its
// tasks as a bar with the count, and its state.
export default function InitiativeRow({
  initiative,
  projectKey,
  owner,
  why,
}: {
  initiative: Initiative;
  projectKey: string;
  owner: Assignee | null;
  // The Helena goal it serves, as its ladder (owner, 28.09.: Ziel-Leiter).
  why?: string[] | null;
}) {
  const t = useTranslations('initiatives');
  const priorityLabel = usePriorityLabel();
  const { progress } = initiative;
  const done = progress.completed;
  const total = progress.total - progress.canceled;
  const percent = progressPercent(progress);

  return (
    <li>
      <Link href={initiativePath(projectKey, initiative.id)} className="ds-goal-row">
        <span
          className="ds-goal-dot"
          style={{ backgroundColor: STATUS_META[initiative.status].color }}
          aria-hidden="true"
        />
        <span className="ds-goal-main">
          <span className="ds-goal-title">{initiative.title}</span>
          <span className="ds-goal-meta">
            {owner ? (
              <span className="ds-goal-owner">
                <AssigneeAvatar name={owner.name} image={owner.image} />
                {owner.name}
              </span>
            ) : (
              <span>{t('noOwner')}</span>
            )}
            {initiative.targetDate && (
              <span>
                {t('columns.target')} {formatShortDate(initiative.targetDate)}
              </span>
            )}
            {why && why.length > 0 && (
              <span className="ds-goal-why" title={why.join(' › ')}>
                <Target size={12} aria-hidden="true" />
                {why.join(' › ')}
              </span>
            )}
            {initiative.priority && (
              <span className="ds-goal-owner">
                <PriorityIcon priority={initiative.priority} className="size-3.5" />
                {priorityLabel(initiative.priority)}
              </span>
            )}
          </span>
        </span>
        <span className="ds-goal-progress" title={t('columns.progress')}>
          <span className="ds-goal-bar" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="ds-goal-count">
            {done}/{total}
          </span>
        </span>
        <span className="ds-goal-health">
          <HealthBadge health={initiative.health} />
        </span>
      </Link>
    </li>
  );
}
