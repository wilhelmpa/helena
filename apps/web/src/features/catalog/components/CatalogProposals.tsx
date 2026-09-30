'use client';

import { Bot, Inbox } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  Card,
  EmptyState,
  Inline,
  List,
  ListRow,
  Pill,
  Stack,
  Text,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { CatalogProposal } from '@/lib/api/endpoints/catalog';
import {
  useCatalogIndex,
  useCatalogProposalsQuery,
  useDecideCatalogProposal,
} from '@/services/catalog.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { isSkillKind, sourceLabel } from '../utils/catalog';
import { useState } from 'react';
import CatalogError from './CatalogError';

// What agents suggested from the catalog, with their reason. The owner decides: adopt
// (after seeing the inspection, in the preview) or decline. An agent never installs anything.
export default function CatalogProposals({
  teamId,
  onOpen,
}: {
  teamId: number;
  onOpen: (proposal: CatalogProposal) => void;
}) {
  const t = useTranslations('catalog.proposals');
  const format = useFormatter();
  const proposals = useCatalogProposalsQuery(teamId);
  const index = useCatalogIndex(teamId);
  const agents = useAiAgentsQuery(teamId).data ?? [];
  const decide = useDecideCatalogProposal(teamId);
  const [error, setError] = useState<unknown>(null);

  if (proposals.isPending) return <ListSkeleton rows={3} rowClassName="h-16" />;
  const all = proposals.data ?? [];
  const pending = all.filter((proposal) => proposal.state === 'pending');
  const decided = all.filter((proposal) => proposal.state !== 'pending');
  if (all.length === 0)
    return (
      <EmptyState icon={<Inbox />} title={t('empty.title')}>
        {t('empty.text')}
      </EmptyState>
    );
  const itemOf = (proposal: CatalogProposal) =>
    (index.data ?? []).find((entry) => entry.id === proposal.itemId);
  const agentOf = (proposal: CatalogProposal) =>
    agents.find((agent) => agent.id === proposal.agentId)?.name ?? t('anAgent');
  const when = (proposal: CatalogProposal) =>
    format.dateTime(new Date(proposal.createdAt), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Stack gap={5}>
      <CatalogError error={error} />
      {pending.length === 0 ? (
        <Text size="sm" tone="muted">
          {t('nonePending')}
        </Text>
      ) : (
        <Stack gap={3}>
          {pending.map((proposal) => {
            const item = itemOf(proposal);
            return (
              <Card
                key={proposal.id}
                title={item?.name ?? t('itemNumber', { id: proposal.itemId })}
                meta={t('by', { agent: agentOf(proposal), when: when(proposal) })}
                actions={
                  item && <Pill>{isSkillKind(item.kind) ? t('kindSkill') : t('kindMcp')}</Pill>
                }
              >
                <Stack gap={3}>
                  {item && (
                    <Text size="xs" tone="muted">
                      {sourceLabel(item.source)}
                    </Text>
                  )}
                  <Inline gap={2} align="start">
                    <Bot size={14} aria-hidden="true" />
                    <Text size="sm">{proposal.reason}</Text>
                  </Inline>
                  <Inline gap={2} wrap>
                    <Button variant="primary" onClick={() => onOpen(proposal)}>
                      {t('review')}
                    </Button>
                    <Button
                      disabled={decide.isPending}
                      onClick={() => {
                        setError(null);
                        decide.mutate(
                          { proposalId: proposal.id, decision: 'rejected' },
                          { onError: setError },
                        );
                      }}
                    >
                      {t('reject')}
                    </Button>
                  </Inline>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}
      {decided.length > 0 && (
        <Stack gap={2}>
          <Text size="sm" weight="medium">
            {t('decided')}
          </Text>
          <List label={t('decided')}>
            {decided.map((proposal) => (
              <ListRow
                key={proposal.id}
                title={itemOf(proposal)?.name ?? t('itemNumber', { id: proposal.itemId })}
                subtitle={`${agentOf(proposal)} · ${proposal.reason}`}
                meta={
                  <Pill tone={proposal.state === 'accepted' ? 'success' : 'neutral'}>
                    {t(`state.${proposal.state}`)}
                  </Pill>
                }
              />
            ))}
          </List>
        </Stack>
      )}
    </Stack>
  );
}
