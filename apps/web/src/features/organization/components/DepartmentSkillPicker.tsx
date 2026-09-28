'use client';

import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Button, Popover, PopoverContent, PopoverTrigger, SearchField } from '@/design-system';

// The skills a department allows, picked from the team's skill library: a button that
// names how many are chosen, opening a searchable list with a checkbox per skill.
export default function DepartmentSkillPicker({
  id,
  skills,
  selected,
  disabled,
  onChange,
}: {
  id: string;
  skills: { id: number; name: string; description?: string }[];
  selected: number[];
  disabled?: boolean;
  onChange: (ids: number[]) => void;
}) {
  const t = useTranslations('organization.departments');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? skills.filter((skill) =>
        `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(needle),
      )
    : skills;

  function toggle(skillId: number, on: boolean) {
    onChange(on ? [...selected, skillId] : selected.filter((entry) => entry !== skillId));
  }

  return (
    <Popover onOpenChange={(open) => !open && setQuery('')}>
      <PopoverTrigger asChild>
        <Button id={id} size="small" disabled={disabled} icon={<ChevronDown aria-hidden />}>
          {t('skillsCount', { count: selected.length })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-2">
        <SearchField
          icon={<Search aria-hidden className="size-4" />}
          value={query}
          placeholder={t('skillsSearch')}
          aria-label={t('skillsSearch')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {skills.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('skillsNone')}</p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('skillsNoMatch')}</p>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {shown.map((skill) => {
              const checkboxId = `${id}-skill-${skill.id}`;
              return (
                <li key={skill.id}>
                  <label
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selected.includes(skill.id)}
                      onCheckedChange={(value) => toggle(skill.id, value === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
