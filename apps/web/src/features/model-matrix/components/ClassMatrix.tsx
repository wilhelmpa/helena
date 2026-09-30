'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonLink, Inline, Pill, Table, Td, Text, Th, Tr, type PillTone } from '@/design-system';
import type { EvalStatus, MatrixClass, MatrixDecision } from '@/lib/api/endpoints/modelMatrix';
import { helenaSettingsPath } from '@/features/settings/settingsModalCatalog';
import { classModelLabel } from '../utils/modelLabels';
import type { MatrixLabels } from '../utils/labels';

const GROUPS = ['chat', 'decision', 'other'] as const;
const CHAT = new Set([
  'triage',
  'routines',
  'hermes-helpers',
  'summaries',
  'reflection',
  'voice-reply',
  'coordinator-triage',
]);
const OTHER = new Set(['embeddings', 'tts', 'stt']);
const groupOf = (id: string) => (CHAT.has(id) ? 'chat' : OTHER.has(id) ? 'other' : 'decision');
const TONE: Record<EvalStatus, PillTone> = {
  passed: 'success',
  failed: 'danger',
  untested: 'neutral',
};

// The second matrix: which device and model carries each kind of work, and whether its
// evaluation passed. Display only — devices and thresholds are changed in Lokale KI and
// Entscheider, where the switch is ordered and checked.
export function ClassMatrix({ classes, labels }: { classes: MatrixClass[]; labels: MatrixLabels }) {
  const { t } = labels;
  const tRoot = useTranslations('localAi.modelMatrix');
  const words = {
    localDefault: t('model.localDefault'),
    local: t('model.local'),
    configured: t('classes.configuredVoice'),
  };
  const className = (id: string) => {
    const key = `classes.names.${id.replace(/\./g, '_')}`;
    return tRoot.has(key as never) ? tRoot(key as never) : id;
  };
  const score = (value?: number) => (value === undefined ? '' : ` · ${Math.round(value * 100)} %`);
  const decision = (value?: MatrixDecision) => (value ? labels.decision(value) : null);
  return (
    <>
      <Inline gap={2} wrap>
        <ButtonLink href={helenaSettingsPath('local-ai')} variant="ghost" size="small">
          {t('classes.openLocal')}
        </ButtonLink>
        <ButtonLink href={helenaSettingsPath('decisions')} variant="ghost" size="small">
          {t('classes.openDecisions')}
        </ButtonLink>
      </Inline>
      <Table label={t('classes.title')} className="ds-matrix">
        <thead>
          <tr>
            <Th>{t('classes.class')}</Th>
            <Th>{t('classes.device')}</Th>
            <Th>{t('classes.model')}</Th>
            <Th>{t('classes.eval')}</Th>
            <Th>{t('classes.also')}</Th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((group) => {
            const inGroup = classes.filter((entry) => groupOf(entry.id) === group);
            if (!inGroup.length) return null;
            return (
              <Fragment key={group}>
                <Tr className="ds-matrix-group-row">
                  <Td colSpan={5}>{t(`classes.groups.${group}`)}</Td>
                </Tr>
                {inGroup.map((entry) => (
                  <Tr key={entry.id}>
                    <Td label={t('classes.class')}>
                      <Text weight="medium">{className(entry.id)}</Text>
                    </Td>
                    <Td label={t('classes.device')}>{t(`classes.devices.${entry.device}`)}</Td>
                    <Td label={t('classes.model')}>
                      <span>{classModelLabel(entry.model, words)}</span>
                      {decision(entry.decision) && (
                        <Text as="div" size="xs" tone="faint">
                          {decision(entry.decision)}
                        </Text>
                      )}
                    </Td>
                    <Td label={t('classes.eval')}>
                      <Pill tone={TONE[entry.eval]}>
                        {t(`classes.evals.${entry.eval}`)}
                        {score(entry.score)}
                      </Pill>
                    </Td>
                    <Td label={t('classes.also')}>
                      {entry.candidates.length === 0 ? (
                        <Text tone="faint">–</Text>
                      ) : (
                        <Inline gap={1} wrap>
                          {entry.candidates.map((candidate) => (
                            <Pill
                              key={`${candidate.device}-${candidate.model}`}
                              tone={TONE[candidate.eval]}
                              title={t(`classes.evals.${candidate.eval}`)}
                            >
                              {t(`classes.devices.${candidate.device}`)} ·{' '}
                              {classModelLabel(candidate.model, words)}
                              {score(candidate.score)}
                            </Pill>
                          ))}
                        </Inline>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
