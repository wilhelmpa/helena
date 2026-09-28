'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { Button, Pill } from '@/design-system';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import { useSkillOptionsQuery } from '@/services/agentSkills.service';
import { useDepartmentSkillsQuery, useSetDepartmentSkills } from '../services/organization.service';
import DepartmentSkillPicker from './DepartmentSkillPicker';

type Draft = { restricted: boolean; skillIds: number[] };

// A department's skill lock: while "Nur freigegebene Skills" is on, the agents of the
// department may only use the skills chosen here. The change is a draft until saved, like
// the budgets above it.
export default function DepartmentSkills({
  teamId,
  department,
}: {
  teamId: number;
  department: OrganizationDepartment;
}) {
  const t = useTranslations('organization.departments');
  const tCommon = useTranslations('common');
  const id = useId();
  const stored = useDepartmentSkillsQuery(teamId, department.id);
  const library = useSkillOptionsQuery(teamId);
  const save = useSetDepartmentSkills(teamId, department.id);
  // null while nothing was changed: the form then shows what is stored.
  const [draft, setDraft] = useState<Draft | null>(null);

  if (!stored.data) return null;
  const current: Draft = draft ?? {
    restricted: stored.data.restricted,
    skillIds: stored.data.skills.map((skill) => skill.id),
  };
  const skills = library.data ?? stored.data.skills;
  const names = new Map(skills.map((skill) => [skill.id, skill.name]));
  const chosen = current.skillIds.map((skillId) => names.get(skillId) ?? `#${skillId}`);

  function submit() {
    save.mutate(current, {
      onSuccess: () => {
        setDraft(null);
        toast.success(t('skillsSaved', { name: department.name }));
      },
    });
  }

  return (
    <div className="ds-department-budgets">
      <span className="ds-mono-label">{t('skills')}</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-restricted`} className="text-sm">
            {t('skillsRestricted')}
          </label>
          <p className="ds-department-budgets-hint">{t('skillsRestrictedHint')}</p>
        </div>
        <Switch
          id={`${id}-restricted`}
          checked={current.restricted}
          disabled={save.isPending}
          onCheckedChange={(restricted) => setDraft({ ...current, restricted })}
        />
      </div>
      {current.restricted && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor={`${id}-skills`} className="text-sm">
              {t('skillsAllowed')}
            </label>
            <DepartmentSkillPicker
              id={`${id}-skills`}
              skills={library.data ?? stored.data.skills}
              selected={current.skillIds}
              disabled={save.isPending}
              onChange={(skillIds) => setDraft({ ...current, skillIds })}
            />
          </div>
          {chosen.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {chosen.map((name) => (
                <Pill key={name}>{name}</Pill>
              ))}
            </div>
          ) : (
            <p className="ds-department-budgets-hint">{t('skillsEmptyWarning')}</p>
          )}
        </>
      )}
      <div className="ds-department-budgets-actions">
        <Button size="small" disabled={draft === null || save.isPending} onClick={submit}>
          {save.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
