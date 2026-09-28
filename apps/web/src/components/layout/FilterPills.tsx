'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { FilterCondition, FilterSet } from '@/utils/filters';
import type { FieldSpec } from '@/utils/filterFields';
import { newCondition, useFilterFields } from '@/hooks/useFilterFields';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import FilterConditionPill from '@/components/layout/FilterConditionPill';

const same = (a: FilterCondition, b: FilterCondition) =>
  a.field === b.field && a.op === b.op && JSON.stringify(a.values) === JSON.stringify(b.values);

// The filters of a page's toolbar as pills (docs/design-system.md §9, draft
// Aufgaben-filter-*): one pill per condition — grey when it is a rule of the saved view,
// lifted with a × when it was added or changed since — then "+ Filter". A pill opens
// its condition's editor right under it; "+ Filter" opens a searchable list of
// properties, and choosing one adds the condition and opens its values at once.
export default function FilterPills({
  filters,
  saved,
  onChange,
  project,
  customFields,
}: {
  filters: FilterSet;
  // The saved view's own conditions (shown as its fixed rules).
  saved?: FilterSet | null;
  onChange: (filters: FilterSet) => void;
  project: ProjectDetail;
  customFields: CustomField[];
}) {
  const t = useTranslations('filters');
  const { fieldSpecs, valuesLabel, operatorLabel } = useFilterFields(project.project.key);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const specs = fieldSpecs(project, customFields);
  const specByField = new Map(fieldSpecs(project, customFields, filters).map((s) => [s.field, s]));

  const update = (id: string, patch: Partial<FilterCondition>) =>
    onChange({ conditions: filters.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) =>
    onChange({ conditions: filters.conditions.filter((c) => c.id !== id) });
  const add = (spec: FieldSpec) => {
    const condition = newCondition(spec);
    onChange({ conditions: [...filters.conditions, condition] });
    setAddOpen(false);
    setQuery('');
    // The new condition's values open right away (the draft's submenu of values).
    setOpenId(condition.id);
  };
  const matches = specs.filter((spec) =>
    spec.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div className="ds-filter-pills">
      {filters.conditions.map((cond) => {
        const spec = specByField.get(cond.field);
        if (!spec) return null;
        const fixed = saved?.conditions.some((rule) => same(rule, cond)) ?? false;
        const presence = cond.op === 'is_set' || cond.op === 'is_not_set';
        const label = presence
          ? `${spec.label} ${operatorLabel(cond.op)}`
          : `${spec.label}: ${valuesLabel(spec, cond)}`;
        return (
          <Popover
            key={cond.id}
            open={openId === cond.id}
            onOpenChange={(open) => setOpenId(open ? cond.id : null)}
          >
            <span className="ds-filter-pill" data-tone={fixed ? 'neutral' : 'active'}>
              <PopoverTrigger asChild>
                <button type="button" className="ds-filter-pill-label">
                  {label}
                </button>
              </PopoverTrigger>
              {!fixed && (
                <button
                  type="button"
                  className="ds-filter-pill-remove"
                  aria-label={t('remove')}
                  title={t('remove')}
                  onClick={() => remove(cond.id)}
                >
                  <X size={12} />
                </button>
              )}
            </span>
            <PopoverContent align="start" className="ds-filter-editor">
              <FilterConditionPill
                spec={spec}
                cond={cond}
                project={project}
                stacked
                onOperatorChange={(op) => update(cond.id, { op })}
                onValuesChange={(values) => update(cond.id, { values })}
                onRemove={() => {
                  remove(cond.id);
                  setOpenId(null);
                }}
              />
            </PopoverContent>
          </Popover>
        );
      })}
      <Popover
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" className="ds-filter-pill ds-filter-add" data-tone="neutral">
            {`+ ${t('filter')}`}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="ds-filter-menu">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchProperty')}
            aria-label={t('searchProperty')}
            className="ds-filter-search"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the list is searched first
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) add(matches[0]);
            }}
          />
          <div className="ds-filter-fields" role="listbox" aria-label={t('add')}>
            {matches.map((spec) => (
              <button
                key={spec.field}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => add(spec)}
              >
                {spec.label}
              </button>
            ))}
            {matches.length === 0 && <p className="ds-filter-none">{t('noProperty')}</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
