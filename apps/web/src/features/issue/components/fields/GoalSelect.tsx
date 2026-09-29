import { useContext, useState } from 'react';
import { Check, CircleDashed, Plus, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShellCtx } from '@/context/shellContext';
import { useGoalOptionsQuery } from '@/services/goalOptions.service';
import { createGoal, type GoalInput } from '@/lib/api/endpoints/organization';
import { qk } from '@/services/queryKeys';
import type { GoalRef } from '@/lib/api/endpoints/issues';
import type { ProjectPoolGoal } from '@/lib/api/endpoints/projectGoals';
import { GOAL_STATUS_META, goalsOfScope } from '@/utils/goalMeta';
import { colorDot } from '@/components/common/fields/colorDot';
import ReadOnlyPill from '@/components/common/fields/ReadOnlyPill';
import { Pill } from '@/components/common/fields/Pill';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger, Text } from '@/design-system';

// The "Ziel" of a task: a Pill trigger opening the goals the task can serve — the project's
// own, its department's and the team-wide ones, grouped, searchable, each with the
// project's progress on it. A team owner or manager can name a goal that does not exist yet
// in the search field and create it right there (a goal of this project). `value` is the goal
// the task names itself; `legacy` is the title of an old project initiative the task still
// hangs under, shown only while no goal is chosen, so nothing it was linked to goes missing.
export default function GoalSelect({
  projectKey,
  projectId,
  teamId,
  value,
  legacy,
  onChange,
  readOnly,
}: {
  projectKey: string;
  projectId: number;
  teamId: number;
  value: GoalRef | null;
  legacy?: string | null;
  onChange: (goal: GoalRef | null) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations('issue.goalSelect');
  const tStatus = useTranslations('organization.statuses');
  // Creating a goal is for the team's owners and managers (the API's teamManager guard); a
  // project owner who is neither picks from the list only.
  const teamRole = useContext(ShellCtx)?.project?.viewer.teamRole;
  const canCreate = teamRole === 'owner' || teamRole === 'manager';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const queryClient = useQueryClient();
  const options = useGoalOptionsQuery(projectKey, open);
  // The team's own goal lists and this picker both read what a new goal changes.
  const create = useMutation({
    mutationFn: (input: GoalInput) => createGoal(teamId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.organization(teamId) }),
  });
  const goals = options.data ?? [];
  const chosen = value ?? null;

  const trigger = (
    <Pill active={chosen != null} title={chosen ? undefined : (legacy ?? undefined)}>
      {chosen ? (
        colorDot(GOAL_STATUS_META[chosen.status].color)
      ) : legacy ? (
        <Target />
      ) : (
        <CircleDashed />
      )}
      <span className="truncate">{chosen?.title ?? legacy ?? t('label')}</span>
    </Pill>
  );
  if (readOnly) return <ReadOnlyPill>{trigger}</ReadOnlyPill>;

  const pick = (goal: GoalRef | null) => {
    onChange(goal);
    setOpen(false);
  };

  const exact = goals.some(
    (goal) => goal.title.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
  );
  const createNamed = async () => {
    const title = query.trim();
    if (!title) return;
    const id = toast.loading(t('creating'));
    try {
      const goal = await create.mutateAsync({
        title,
        projectId,
        status: 'active',
      });
      await queryClient.invalidateQueries({ queryKey: qk.goalOptions(projectKey) });
      toast.dismiss(id);
      pick({ id: goal.id, title: goal.title, status: goal.status });
    } catch (error) {
      toast.dismiss(id);
      throw error;
    }
  };

  const groups: { key: ProjectPoolGoal['scope']; heading: string }[] = [
    { key: 'project', heading: t('scopeProject') },
    { key: 'department', heading: t('scopeDepartment') },
    { key: 'team', heading: t('scopeTeam') },
  ];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="ds-goal-popover" align="start">
        <Command>
          <CommandInput placeholder={t('search')} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={t('none')} onSelect={() => pick(null)}>
                <CircleDashed />
                <span className="flex-1">{t('none')}</span>
                {chosen == null && <Check className="ms-auto" />}
              </CommandItem>
            </CommandGroup>
            {groups.map(({ key, heading }) => {
              const rows = goalsOfScope(goals, key);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={key} heading={heading}>
                  {rows.map((goal) => (
                    <CommandItem
                      key={goal.id}
                      value={`${goal.title} ${goal.path.join(' ')}`}
                      title={[...goal.path, goal.title].join(' › ')}
                      onSelect={() => pick({ id: goal.id, title: goal.title, status: goal.status })}
                    >
                      {colorDot(GOAL_STATUS_META[goal.status].color)}
                      <span className="flex-1 truncate">{goal.title}</span>
                      {goal.status !== 'active' && (
                        <Text size="xs" tone="muted">
                          {tStatus(goal.status)}
                        </Text>
                      )}
                      {goal.progress && goal.progress.total > 0 && (
                        <Text size="xs" tone="muted" tabular title={t('progress', goal.progress)}>
                          {goal.progress.done}/{goal.progress.total}
                        </Text>
                      )}
                      {goal.id === chosen?.id && <Check className="ms-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {canCreate && query.trim() !== '' && !exact && (
              <CommandGroup>
                <CommandItem
                  forceMount
                  value={`__create ${query}`}
                  onSelect={() => void createNamed()}
                >
                  <Plus />
                  <span className="flex-1 truncate">
                    {t('createNamed', { title: query.trim() })}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
