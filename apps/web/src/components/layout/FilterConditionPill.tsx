import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { FilterCondition, FilterOperator, FilterValue } from '@/utils/filters';
import { OPERATORS_BY_KIND, type FieldSpec } from '@/utils/filterFields';
import { useFilterFields } from '@/hooks/useFilterFields';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import FilterValueEditor from '@/components/layout/FilterValueEditor';

// One condition in the filter bar: the field label, its operator, the value
// editor for its kind, and a remove button. `stacked` is its row in the header's
// filter popover: full width, the remove button at the end.
export default function FilterConditionPill({
  spec,
  cond,
  project,
  stacked = false,
  onOperatorChange,
  onValuesChange,
  onRemove,
}: {
  spec: FieldSpec;
  cond: FilterCondition;
  project: ProjectDetail;
  stacked?: boolean;
  onOperatorChange: (op: FilterOperator) => void;
  onValuesChange: (values: FilterValue[]) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('filters');
  const { operatorLabel } = useFilterFields();
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border bg-card py-0.5 ps-2 pe-0.5 text-sm',
        stacked && 'min-h-8',
      )}
    >
      <span className={cn('font-medium text-foreground', stacked && 'w-32 shrink-0 truncate')}>
        {spec.label}
      </span>
      <Select value={cond.op} onValueChange={(v) => onOperatorChange(v as FilterOperator)}>
        <SelectTrigger
          size="sm"
          className="h-6 gap-1 border-0 bg-transparent px-1 text-sm text-muted-foreground shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS_BY_KIND[spec.kind].map((op) => (
            <SelectItem key={op} value={op}>
              {operatorLabel(op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FilterValueEditor spec={spec} cond={cond} onChange={onValuesChange} project={project} />
      <button
        type="button"
        onClick={onRemove}
        title={t('remove')}
        aria-label={t('remove')}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground',
          stacked && 'ms-auto',
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
