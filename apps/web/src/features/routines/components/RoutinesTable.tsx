import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RoutineActions } from './RoutineActionsMenu';
import { RoutineRow } from './RoutineRow';

export function RoutinesTable({
  routines,
  showProject = false,
  actionsFor,
}: {
  routines: Routine[];
  showProject?: boolean;
  actionsFor?: (routine: Routine) => RoutineActions;
}) {
  const t = useTranslations('routines');
  const tCommon = useTranslations('common');
  const head = 'text-xs font-medium text-muted-foreground';
  return (
    <Table className="min-w-[960px] table-fixed">
      <colgroup>
        {showProject && <col className="w-[16%]" />}
        <col className={showProject ? 'w-[26%]' : 'w-[34%]'} />
        <col className="w-[22%]" />
        <col className="w-[24%]" />
        <col className="w-[10%]" />
        {actionsFor && <col className="w-[8%]" />}
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {showProject && <TableHead className={head}>{t('project')}</TableHead>}
          <TableHead className={head}>{t('name')}</TableHead>
          <TableHead className={head}>{t('schedule')}</TableHead>
          <TableHead className={head}>{t('lastRun')}</TableHead>
          <TableHead className={head}>{t('status')}</TableHead>
          {actionsFor && <TableHead className={`text-end ${head}`}>{tCommon('actions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {routines.map((routine) => (
          <RoutineRow
            key={routine.id}
            routine={routine}
            showProject={showProject}
            actions={actionsFor?.(routine)}
          />
        ))}
      </TableBody>
    </Table>
  );
}
