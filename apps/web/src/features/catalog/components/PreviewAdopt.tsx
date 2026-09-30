'use client';

import { useState } from 'react';
import { Bot, Check, History, Play, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, DetailGroup, Inline, Notice, Stack, Text } from '@/design-system';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import type { CatalogPreview, CatalogProposal } from '@/lib/api/endpoints/catalog';
import {
  useAdoptCatalogItem,
  useDecideCatalogProposal,
  useRollbackCatalogItem,
} from '@/services/catalog.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { isSkillKind, shortPin, verdictOf } from '../utils/catalog';
import { choiceOf, scopeOf, type ScopeChoice } from '../utils/scope';
import CatalogError from './CatalogError';
import { FindingsBlock } from './FindingsView';
import ScopePicker from './ScopePicker';

// Adoption of the inspected version: whom it goes to, the findings that need a decision
// and the one button that pins it. Blocked versions offer nothing; findings to review need
// an explicit confirmation first. An installed entry can also go back to its previous
// version here. With a proposal of an agent the assignment is that agent and the button
// answers the proposal.
export default function PreviewAdopt({
  teamId,
  preview,
  proposal,
  busy,
  onInspect,
  onClose,
}: {
  teamId: number;
  preview: CatalogPreview;
  proposal: CatalogProposal | null;
  busy: boolean;
  onInspect: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('catalog.adopt');
  const { item, source, latest, install, revisions } = preview;
  const [choice, setChoice] = useState<ScopeChoice>(() => choiceOf(install?.scope));
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmingRollback, setConfirmingRollback] = useState(false);
  const adopt = useAdoptCatalogItem(teamId);
  const decide = useDecideCatalogProposal(teamId);
  const rollback = useRollbackCatalogItem(teamId);
  const agents = useAiAgentsQuery(proposal ? teamId : null).data ?? [];
  const proposedBy = agents.find((agent) => agent.id === proposal?.agentId)?.name;
  const skill = isSkillKind(source.kind);
  const working = adopt.isPending || decide.isPending || rollback.isPending;

  if (!latest)
    return (
      <Notice
        icon={<Search />}
        title={t('notInspected.title')}
        action={
          <Button variant="primary" icon={<Play />} disabled={busy} onClick={onInspect}>
            {busy ? t('inspecting') : t('inspectNow')}
          </Button>
        }
      >
        {t('notInspected.text')}
      </Notice>
    );

  const verdict = verdictOf(latest.findings);
  const current = install?.revisionId === latest.id;
  const scope = proposal ? {} : scopeOf(choice);
  // A version already adopted was confirmed then; changing whom it goes to needs no second confirmation.
  const needsAck = verdict === 'review' && !current;
  const ready = verdict !== 'blocked' && scope != null && (!needsAck || ack);
  const previous = revisions.find((revision) => revision.id === install?.previousRevisionId);

  const onSuccess = () => {
    setDone(shortPin(latest.pin));
    setAck(false);
    setError(null);
  };
  const submit = () => {
    setError(null);
    setDone(null);
    if (proposal) {
      decide.mutate(
        {
          proposalId: proposal.id,
          decision: 'accepted',
          revisionId: latest.id,
          acknowledgeFindings: ack,
        },
        {
          onSuccess: () => {
            onSuccess();
            onClose();
          },
          onError: setError,
        },
      );
      return;
    }
    if (!scope) return;
    adopt.mutate(
      { itemId: item.id, revisionId: latest.id, scope, acknowledgeFindings: ack || current },
      { onSuccess, onError: setError },
    );
  };
  const reject = () => {
    if (!proposal) return;
    setError(null);
    decide.mutate(
      { proposalId: proposal.id, decision: 'rejected' },
      { onSuccess: onClose, onError: setError },
    );
  };

  return (
    <Stack gap={5}>
      {proposal && (
        <Notice
          icon={<Bot />}
          title={t('proposal.title', { agent: proposedBy ?? t('proposal.agent') })}
        >
          {proposal.reason}
        </Notice>
      )}
      <FindingsBlock findings={latest.findings} license={latest.license} kind={source.kind} />

      {verdict !== 'blocked' && (
        <DetailGroup title={proposal ? t('proposal.forAgent') : t('forWhom')}>
          <Stack gap={4}>
            {!proposal && <ScopePicker teamId={teamId} value={choice} onChange={setChoice} />}
            {!skill && (
              <Text size="xs" tone="muted">
                {t('mcpHint')}
              </Text>
            )}
            {needsAck && (
              <Inline as="label" gap={2} align="start">
                <Checkbox checked={ack} onCheckedChange={(next) => setAck(next === true)} />
                <Text size="sm">{t('acknowledge')}</Text>
              </Inline>
            )}
            <CatalogError error={error} />
            {done && <Notice icon={<Check />} title={t('done', { pin: done })} />}
            <Inline gap={2} wrap>
              <Button variant="primary" disabled={!ready || working} onClick={submit}>
                {proposal
                  ? t('acceptProposal')
                  : install
                    ? current
                      ? t('reassign')
                      : t('update', { pin: shortPin(latest.pin) })
                    : t('adopt', { pin: shortPin(latest.pin) })}
              </Button>
              {proposal && (
                <Button disabled={working} onClick={reject}>
                  {t('rejectProposal')}
                </Button>
              )}
            </Inline>
          </Stack>
        </DetailGroup>
      )}

      {install?.previousRevisionId && previous && !proposal && (
        <DetailGroup title={t('rollback.title')}>
          <Stack gap={3}>
            <Text size="sm" tone="muted">
              {t('rollback.text', { pin: shortPin(previous.pin) })}
            </Text>
            <Inline>
              <Button
                icon={<History />}
                disabled={working}
                onClick={() => setConfirmingRollback(true)}
              >
                {t('rollback.action', { pin: shortPin(previous.pin) })}
              </Button>
            </Inline>
          </Stack>
        </DetailGroup>
      )}
      {verdict === 'blocked' && <CatalogError error={error} />}

      {confirmingRollback && previous && (
        <ConfirmDialog
          title={t('rollback.title')}
          confirmLabel={t('rollback.confirm')}
          onConfirm={async () => {
            try {
              await rollback.mutateAsync(item.id);
              setError(null);
            } catch (failure) {
              setError(failure);
            }
            setConfirmingRollback(false);
          }}
          onClose={() => setConfirmingRollback(false)}
        >
          <Text size="sm" tone="muted">
            {t('rollback.confirmText', { name: item.name, pin: shortPin(previous.pin) })}
          </Text>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
