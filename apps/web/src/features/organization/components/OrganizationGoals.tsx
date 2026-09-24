'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RowEmpty, RowList } from '@/components/common/page/RowList';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useCreateGoal } from '../services/organization.service';
import OrganizationGoalCard from './OrganizationGoalCard';

export default function OrganizationGoals({
  teamId,
  goals,
  departments,
  projects,
}: {
  teamId: number;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
}) {
  const t = useTranslations('organization');
  const create = useCreateGoal(teamId);
  const [title, setTitle] = useState('');

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { title },
            {
              onSuccess: () => setTitle(''),
            },
          );
        }}
      >
        <Input
          value={title}
          maxLength={160}
          placeholder={t('goals.newPlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending || !title.trim()}>
          {t('actions.add')}
        </Button>
      </form>
      {goals.length === 0 ? (
        <RowList className="bg-card">
          <RowEmpty>{t('goals.empty')}</RowEmpty>
        </RowList>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {goals.map((goal) => (
            <OrganizationGoalCard
              key={goal.id}
              teamId={teamId}
              goal={goal}
              goals={goals}
              departments={departments}
              projects={projects}
            />
          ))}
        </div>
      )}
    </div>
  );
}
