'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, List, ListRow, Pill, Stack, Text } from '@/design-system';
import type { NativeSkill, SkillChange } from '@/lib/api/endpoints/agentLearning';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { actorOf, changeKind } from '../../utils/skillEntries';
import TextDiff from '../TextDiff';

// Every version of a learned skill, newest first: what happened (created, changed, pinned,
// archived …), who did it, when, in which session, and the text before and after. A version
// that waits for the owner offers the decision.
export default function SkillHistory({
  skill,
  canReview,
  busy,
  onReview,
  onOpenSession,
}: {
  skill: NativeSkill;
  canReview: boolean;
  busy: boolean;
  onReview: (action: 'approve' | 'reject') => void;
  // Opens the agent's sessions, where the session of a version can be found.
  onOpenSession: (() => void) | null;
}) {
  const t = useTranslations('agentPages.skills');
  const format = useFormatter();
  const relative = useRelativeTime();
  const versions = [...(skill.history ?? [])].reverse();
  const [open, setOpen] = useState<string | null>(versions[0]?.id ?? null);

  if (versions.length === 0) {
    return (
      <Text tone="muted" size="sm">
        {t('history.empty')}
      </Text>
    );
  }
  return (
    <List label={t('history.title')}>
      {versions.map((change) => {
        const actor = actorOf(change.actor);
        const isOpen = open === change.id;
        return (
          <div key={change.id} className="ds-skill-version">
            <ListRow
              title={t(`action.${changeKind(change.action)}`)}
              subtitle={[
                t(`actor.${actor}`),
                format.dateTime(new Date(change.at), { dateStyle: 'medium', timeStyle: 'short' }),
              ].join(' · ')}
              dot={change.status === 'pending' ? 'waiting' : null}
              meta={
                <>
                  {change.status === 'pending' && (
                    <Pill tone="warning">{t('history.pending')}</Pill>
                  )}
                  {change.status === 'rejected' && <Pill>{t('history.rejected')}</Pill>}
                  <span
                    title={format.dateTime(new Date(change.at), {
                      dateStyle: 'full',
                      timeStyle: 'medium',
                    })}
                  >
                    {relative(change.at)}
                  </span>
                </>
              }
              selected={isOpen}
              onSelect={() => setOpen(isOpen ? null : change.id)}
            />
            {isOpen && (
              <VersionBody
                change={change}
                canReview={canReview}
                busy={busy}
                onReview={onReview}
                onOpenSession={change.sessionId ? onOpenSession : null}
              />
            )}
          </div>
        );
      })}
    </List>
  );
}

function VersionBody({
  change,
  canReview,
  busy,
  onReview,
  onOpenSession,
}: {
  change: SkillChange;
  canReview: boolean;
  busy: boolean;
  onReview: (action: 'approve' | 'reject') => void;
  onOpenSession: (() => void) | null;
}) {
  const t = useTranslations('agentPages.skills');
  const changed = change.before?.markdown !== change.after.markdown;
  const fileChanges = fileDiffs(change);
  return (
    <Stack gap={3} className="ds-skill-version-body">
      <Text size="xs" tone="muted">
        {t('history.versionOf', { version: change.version })}
        {change.sessionId && (
          <>
            {' · '}
            {onOpenSession ? (
              <button type="button" className="ds-link-button" onClick={onOpenSession}>
                {t('history.session')}
              </button>
            ) : (
              t('history.session')
            )}
          </>
        )}
      </Text>
      {changed ? (
        <TextDiff before={change.before?.markdown ?? ''} after={change.after.markdown} />
      ) : fileChanges.length === 0 ? (
        <Text size="xs" tone="muted">
          {t('history.sameText')}
        </Text>
      ) : null}
      {fileChanges.map((file) => (
        <Stack key={file.path} gap={1}>
          <Text size="xs" tone="muted" mono>
            {file.path}
          </Text>
          <TextDiff before={file.before} after={file.after} />
        </Stack>
      ))}
      {change.status === 'pending' && canReview && (
        <div className="ds-skill-version-actions">
          <Button
            variant="primary"
            size="small"
            disabled={busy}
            onClick={() => onReview('approve')}
          >
            {t('actions.approve')}
          </Button>
          <Button size="small" disabled={busy} onClick={() => onReview('reject')}>
            {t('actions.reject')}
          </Button>
        </div>
      )}
    </Stack>
  );
}

// The reference files a version added, changed or removed.
function fileDiffs(change: SkillChange): { path: string; before: string; after: string }[] {
  const before = new Map((change.before?.files ?? []).map((file) => [file.path, file.content]));
  const after = new Map(change.after.files.map((file) => [file.path, file.content]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => ({ path, before: before.get(path) ?? '', after: after.get(path) ?? '' }));
}
