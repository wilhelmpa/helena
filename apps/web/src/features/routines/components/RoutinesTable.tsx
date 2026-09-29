import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import type { RoutineActions } from './RoutineActionsMenu';
import { RoutineItem } from './RoutineItem';
import { RoutineRow } from './RoutineRow';
import { Table, Th, Tr } from '@/design-system';

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
      <Table stack={false} className="min-w-[860px] table-fixed max-md:hidden">
        <colgroup>
          {showProject && <col className="w-[16%]" />}
          <col className={showProject ? 'w-[26%]' : 'w-[34%]'} />
          <col className="w-[22%]" />
          <col className="w-[24%]" />
          <col className="w-[10%]" />
          {actionsFor && <col className="w-[8%]" />}
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            {showProject && <Th className={head}>{t('project')}</Th>}
            <Th className={head}>{t('name')}</Th>
            <Th className={head}>{t('schedule')}</Th>
            <Th className={head}>{t('lastRun')}</Th>
            <Th className={head}>{t('status')}</Th>
            {actionsFor && (
              <Th alignment="end" className={head}>
                {tCommon('actions')}
              </Th>
            )}
          </Tr>
        </thead>
        <tbody>
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              showProject={showProject}
              actions={actionsFor?.(routine)}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}
