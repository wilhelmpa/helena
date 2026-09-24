import { useState } from 'react';
import { Filter, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { isActiveFilterSet, type FilterCondition, type FilterSet } from '@/utils/filters';
import type { FieldSpec } from '@/utils/filterFields';
import { newCondition, useFilterFields } from '@/hooks/useFilterFields';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import FilterConditionPill from '@/components/layout/FilterConditionPill';

type FilterBarProps = {
  filters: FilterSet;
  onChange: (filters: FilterSet) => void;
  project: ProjectDetail;
  customFields: CustomField[];
};

// The filter conditions plus an add-condition button. Filters apply to whichever
// layout is active; empty/half-built conditions are ignored. `stacked` lays the
// conditions out one per row (the header's filter popover, see FilterControl);
// otherwise they wrap as pills (the widget and workflow settings forms).
export default function FilterBar({
  filters,
  onChange,
  project,
  customFields,
  stacked = false,
}: FilterBarProps & { stacked?: boolean }) {
  const t = useTranslations('filters');
  const { fieldSpecs } = useFilterFields(project.project.key);
  const [addOpen, setAddOpen] = useState(false);
  const specs = fieldSpecs(project, customFields);
  // The pills read a catalog that also carries the fields only the current
  // conditions still name, so a condition on a switched-off section stays visible
  // and removable while the add menu no longer offers it.
  const specByField = new Map(fieldSpecs(project, customFields, filters).map((s) => [s.field, s]));

  const update = (id: string, patch: Partial<FilterCondition>) =>
    onChange({ conditions: filters.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const remove = (id: string) =>
    onChange({ conditions: filters.conditions.filter((c) => c.id !== id) });

  const add = (spec: FieldSpec) => {
    onChange({ conditions: [...filters.conditions, newCondition(spec)] });
    setAddOpen(false);
  };

  const fieldList = (
    <div className="flex flex-col">
      {specs.map((spec) => (
        <button
          key={spec.field}
          type="button"
          onClick={() => add(spec)}
          className="h-8 w-full shrink-0 truncate rounded-md px-2 text-start text-sm hover:bg-accent"
        >
          {spec.label}
        </button>
      ))}
    </div>
  );

  // In the popover with nothing set yet, the fields to filter by are the content
  // itself: one click adds the first condition.
  if (stacked && filters.conditions.length === 0) {
    return (
      <div className="max-h-80 overflow-auto">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{t('add')}</p>
        {fieldList}
      </div>
    );
  }

  return (
    <div
      className={cn('flex items-center gap-1.5', stacked ? 'flex-col items-stretch' : 'flex-wrap')}
    >
      {filters.conditions.map((cond) => {
        const spec = specByField.get(cond.field);
        if (!spec) return null; // a field that no longer exists (deleted custom field / column)
        return (
          <FilterConditionPill
            key={cond.id}
            spec={spec}
            cond={cond}
            project={project}
            stacked={stacked}
            onOperatorChange={(op) => update(cond.id, { op })}
            onValuesChange={(values) => update(cond.id, { values })}
            onRemove={() => remove(cond.id)}
          />
        );
      })}

      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('add')}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
              stacked ? 'h-8 px-2' : 'size-7 justify-center',
            )}
          >
            <Plus className="size-4" />
            {stacked ? t('add') : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-56 overflow-auto p-1">
          {fieldList}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// The filter as one control of a page's header row (docs/volition/ui-standard.md
// "one row"): a 32px button that opens the conditions in a popover. An applied filter
// is never hidden: the button is then drawn active and says how many conditions apply.
export function FilterControl(props: FilterBarProps) {
  const t = useTranslations('views');
  const room = usePageToolbarRoom();
  const active = isActiveFilterSet(props.filters);
  const count = props.filters.conditions.length;
  const trigger = (
    <button
      type="button"
      aria-label={t('filter')}
      className={cn(
        PAGE_CONTROL_CLASS,
        active && PAGE_CONTROL_ACTIVE_CLASS,
        !room.actions && count === 0 && 'w-8 justify-center px-0',
      )}
    >
      <Filter aria-hidden="true" />
      {room.actions ? <span>{t('filter')}</span> : null}
      {count > 0 ? (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
  return (
    <Popover>
      {room.actions ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('filter')}</TooltipContent>
        </Tooltip>
      )}
      <PopoverContent align="end" className="w-[min(34rem,calc(100vw-1rem))] p-1.5">
        <FilterBar {...props} stacked />
      </PopoverContent>
    </Popover>
  );
}
