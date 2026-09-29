import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RoutineActions } from './RoutineActionsMenu';
import { RoutineItem } from './RoutineItem';
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
  const head = 'h-9 px-3 text-xs font-medium text-muted-foreground';
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <ul className="divide-y md:hidden">
        {routines.map((routine) => (
          <RoutineItem
            key={routine.id}
            routine={routine}
            showProject={showProject}
            actions={actionsFor?.(routine)}
          />
        ))}
      </ul>
      <Table className="min-w-[860px] table-fixed max-md:hidden">
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
            {actionsFor && (
              <TableHead className={`text-end ${head}`}>{tCommon('actions')}</TableHead>
            )}
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
    </div>
  );
}
