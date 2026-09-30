'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, ChevronDown, ChevronRight, CircleDot, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GoalNote, OrganizationGoal } from '@/lib/api/endpoints/organization';
import { formatDateTime } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { Input } from '@/components/ui/input';
import {
  useDecideGoalNote,
  useGoalDetailQuery,
  useLinkGoalTask,
} from '../services/organization.service';
import { Card, Inline, Stack, Text } from '@/design-system';

// A task identifier ("VOL-12") as the parts its page is addressed by.
function taskHref(identifier: string): string | null {
  const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(identifier);
  return match ? issuePath(match[1]!, Number(match[2])) : null;
}

function author(note: GoalNote): string {
  if (!note.author) return '';
  return note.author.username ? `@${note.author.username}` : note.author.name;
}

// What a goal's work looks like (docs/helena-decisions/agent-context.md §7): its linked
// tasks done out of all, the agents working on the open ones, an agent's proposed status for
// the owner to take or turn down, and on request the tasks and the notes themselves.
export default function OrganizationGoalProgress({
  teamId,
  goal,
}: {
  teamId: number;
  goal: OrganizationGoal;
}) {
  const t = useTranslations('organization');
  const [open, setOpen] = useState(false);
  const progress = goal.progress ?? { total: 0, done: 0, agents: [] };
  const waiting = goal.pendingProposals ?? 0;
  const detail = useGoalDetailQuery(teamId, goal.id, open || waiting > 0);
  const decide = useDecideGoalNote(teamId);
  const link = useLinkGoalTask(teamId);
  const [identifier, setIdentifier] = useState('');
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const proposals = (detail.data?.notes ?? []).filter(
    (note) => note.proposedStatus !== null && note.decision === null,
  );

  return (
    <Stack gap={2} padTop={3} className="border-t">
      <Inline gap={2} justify="between" wrap>
        <span>
          {progress.total === 0
            ? t('goals.noTasks')
            : t('goals.progress', { done: progress.done, total: progress.total })}
        </span>
        {progress.agents.length > 0 && (
          <Text as="span" size="xs" tone="muted" className="flex flex-wrap items-center gap-1.5">
            <Bot className="size-3.5" aria-hidden />
            {t('goals.workingOn', {
              agents: progress.agents.map((agent) => `@${agent.username}`).join(', '),
            })}
          </Text>
        )}
      </Inline>
      {progress.total > 0 && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t('goals.progressLabel')}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      )}

      {proposals.map((note) => (
        <Card tone="inset" pad="tight" gap={2} key={note.id}>
          <p>
            {t('goals.proposal', {
              author: author(note),
              status: t(`statuses.${note.proposedStatus!}`),
            })}
          </p>
          <Text as="p" size="xs" tone="muted" className="whitespace-pre-wrap">
            {note.body}
          </Text>
          <Inline gap={2} justify="end" align="stretch">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ goalId: goal.id, noteId: note.id, accept: false })}
            >
              {t('goals.reject')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ goalId: goal.id, noteId: note.id, accept: true })}
            >
              {t('goals.accept')}
            </Button>
          </Inline>
        </Card>
      ))}

      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {t('goals.details')}
      </button>

      {open && detail.isLoading && (
        <Text as="p" size="xs" tone="muted">
          {t('goals.loading')}
        </Text>
      )}
      {open && detail.data && (
        <Stack gap={3}>
          <Stack gap={1}>
            <Text as="p" size="xs" tone="muted" className="font-medium">
              {t('goals.tasks')}
            </Text>
            {detail.data.tasks.length === 0 ? (
              <Text as="p" size="xs" tone="muted">
                {t('goals.tasksEmpty')}
              </Text>
            ) : (
              <Stack as="ul" gap={1}>
                {detail.data.tasks.map((task) => {
                  const href = taskHref(task.identifier);
                  const done = task.stateType === 'completed' || task.stateType === 'canceled';
                  return (
                    <Inline as="li" gap={2} key={task.issueId} className="min-w-0">
                      <CircleDot
                        className={cn(
                          'size-3.5 shrink-0',
                          task.running ? 'text-primary' : 'text-muted-foreground',
                        )}
                        aria-hidden
                      />
                      {href ? (
                        <Link href={href} className="shrink-0 font-mono text-xs hover:underline">
                          {task.identifier}
                        </Link>
                      ) : (
                        <Text as="span" size="xs" className="shrink-0 font-mono">
                          {task.identifier}
                        </Text>
                      )}
                      <span className={cn('min-w-0 truncate', done && 'text-muted-foreground')}>
                        {task.title}
                      </span>
                      <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0">
                        {task.running
                          ? t('goals.running')
                          : task.assignee
                            ? `${task.stateName} · ${task.assignee.username ? `@${task.assignee.username}` : task.assignee.name}`
                            : task.stateName}
                      </Text>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0"
                        aria-label={t('goals.unlink', { task: task.identifier })}
                        disabled={link.isPending}
                        onClick={() => link.mutate({ goalId: null, issueId: task.issueId })}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </Inline>
                  );
                })}
              </Stack>
            )}
          </Stack>
          <Inline gap={2}>
            <Input
              className="h-8 max-w-40"
              placeholder={t('goals.linkPlaceholder')}
              aria-label={t('goals.link')}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              onKeyDown={(event) => {
                // Inside the goal's form: Enter links the task, it does not save the goal.
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (identifier.trim())
                  link.mutate(
                    { goalId: goal.id, identifier },
                    { onSuccess: () => setIdentifier('') },
                  );
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={link.isPending || !identifier.trim()}
              onClick={() =>
                link.mutate({ goalId: goal.id, identifier }, { onSuccess: () => setIdentifier('') })
              }
            >
              {t('goals.link')}
            </Button>
            {link.isError && (
              <Text as="span" size="xs" tone="danger">
                {t('goals.linkFailed')}
              </Text>
            )}
          </Inline>
          <Stack gap={1}>
            <Text as="p" size="xs" tone="muted" className="font-medium">
              {t('goals.notes')}
            </Text>
            {detail.data.notes.length === 0 ? (
              <Text as="p" size="xs" tone="muted">
                {t('goals.notesEmpty')}
              </Text>
            ) : (
              <Stack as="ul" gap={2}>
                {detail.data.notes.map((note) => (
                  <Stack as="li" gap={1} key={note.id}>
                    <Text as="p" size="xs" tone="muted">
                      {author(note)}
                      {' · '}
                      {formatDateTime(note.createdAt)}
                      {note.proposedStatus &&
                        ` · ${t('goals.proposed', { status: t(`statuses.${note.proposedStatus}`) })}`}
                      {note.decision && ` · ${t(`goals.decision.${note.decision}`)}`}
                    </Text>
                    <p className="whitespace-pre-wrap">{note.body}</p>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
