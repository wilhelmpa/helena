import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Assignee } from '@/lib/api/endpoints/projects';
import type { Initiative } from '@/lib/api/endpoints/initiatives';
import { initiativePath } from '@/utils/paths';
import { formatShortDate } from '@/utils/dates';
import { AssigneeAvatar } from '@/features/issue/components/shared/IssueBadges';
import { PriorityIcon } from '@/features/issue/components/shared/IssueIcons';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { colorDot } from '@/components/common/fields/colorDot';
import { TableCell, TableRow } from '@/components/ui/table';
import { STATUS_META } from '@/utils/initiativeMeta';
import HealthBadge from '../shared/HealthBadge';
import ProgressBar from '@/components/common/ProgressBar';
import { cn } from '@/lib/utils';

// The columns a narrow screen leaves out: a phone shows the name and the progress.
export const INITIATIVE_COLUMN_CLASS: Record<string, string | undefined> = {
  priority: 'hidden md:table-cell',
  owner: 'hidden lg:table-cell',
  target: 'hidden sm:table-cell',
  health: 'hidden md:table-cell',
};

// The whole row navigates to the detail page; the title is also a real anchor so
// middle/cmd-click opens it in a new tab.
export default function InitiativeRow({
  initiative,
  projectKey,
  owner,
}: {
  initiative: Initiative;
  projectKey: string;
  owner: Assignee | null;
}) {
  const t = useTranslations('initiatives');
  const priorityLabel = usePriorityLabel();
  const router = useRouter();
  const href = initiativePath(projectKey, initiative.id);

  return (
    <TableRow
      className="group/item h-10 cursor-pointer hover:bg-accent"
      onClick={() => router.push(href)}
    >
      <TableCell className="px-3 py-2 align-middle whitespace-normal">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">{colorDot(STATUS_META[initiative.status].color)}</span>
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate text-sm font-medium hover:underline"
          >
            {initiative.title}
          </Link>
        </div>
      </TableCell>

      <TableCell className={cn('px-3 py-2 align-middle', INITIATIVE_COLUMN_CLASS.priority)}>
        {initiative.priority ? (
          <span className="flex items-center gap-1.5 text-sm">
            <PriorityIcon priority={initiative.priority} className="size-3.5" />
            <span className="text-muted-foreground">{priorityLabel(initiative.priority)}</span>
          </span>
        ) : (
          <Minus className="size-3.5 text-muted-foreground" />
        )}
      </TableCell>

      <TableCell
        className={cn('overflow-hidden px-3 py-2 align-middle', INITIATIVE_COLUMN_CLASS.owner)}
      >
        {owner ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <AssigneeAvatar name={owner.name} image={owner.image} />
            <span className="truncate text-muted-foreground">{owner.name}</span>
          </span>
        ) : (
          <span className="block truncate text-sm text-muted-foreground">{t('noOwner')}</span>
        )}
      </TableCell>

      <TableCell
        className={cn(
          'px-3 py-2 align-middle text-xs text-muted-foreground',
          INITIATIVE_COLUMN_CLASS.target,
        )}
      >
        {initiative.targetDate ? formatShortDate(initiative.targetDate) : '—'}
      </TableCell>

      <TableCell className="px-3 py-2 align-middle">
        <ProgressBar progress={initiative.progress} />
      </TableCell>

      <TableCell className={cn('px-3 py-2 align-middle', INITIATIVE_COLUMN_CLASS.health)}>
        <HealthBadge health={initiative.health} />
      </TableCell>
    </TableRow>
  );
}
