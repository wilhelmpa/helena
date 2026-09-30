'use client';

import { CircleAlert, Info, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { List, ListRow, Notice, Pill, Stack, type PillTone } from '@/design-system';
import type { CatalogFinding, CatalogSourceKind } from '@/lib/api/endpoints/catalog';
import { isSkillKind, verdictOf } from '../utils/catalog';

const ORDER = { block: 0, review: 1, info: 2 } as const;
const TONE: Record<CatalogFinding['severity'], PillTone> = {
  block: 'danger',
  review: 'warning',
  info: 'neutral',
};

// What the inspection says in one notice: blocked (cannot be adopted), to be reviewed (only
// with an explicit confirmation) or without findings.
export function VerdictNotice({ findings }: { findings: CatalogFinding[] }) {
  const t = useTranslations('catalog.verdict');
  const verdict = verdictOf(findings);
  if (verdict === 'blocked')
    return (
      <Notice tone="danger" icon={<ShieldX />} title={t('blocked.title')}>
        {t('blocked.text')}
      </Notice>
    );
  if (verdict === 'review')
    return (
      <Notice tone="warning" icon={<ShieldAlert />} title={t('review.title')}>
        {t('review.text')}
      </Notice>
    );
  return (
    <Notice icon={<ShieldCheck />} title={t('clean.title')}>
      {t('clean.text')}
    </Notice>
  );
}

// Every finding as one plain sentence with the file it concerns; the technical text of the
// API only shows for a finding this app has no sentence for.
export function FindingList({
  findings,
  license,
  kind,
}: {
  findings: CatalogFinding[];
  license: string | null;
  kind: CatalogSourceKind;
}) {
  const t = useTranslations('catalog.findings');
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const sentence = (finding: CatalogFinding): string => {
    const code =
      finding.code === 'executable' && isSkillKind(kind) ? 'executableSkill' : finding.code;
    if (!t.has(code as never)) return finding.detail;
    const say = t as unknown as (key: string, values: Record<string, unknown>) => string;
    return say(code, {
      license: license ?? t('unknownLicense'),
      count: Number(/^(\d+)/.exec(finding.detail)?.[1] ?? 0),
    });
  };
  if (sorted.length === 0) return null;
  return (
    <List label={t('title')}>
      {sorted.map((finding, index) => (
        <ListRow
          key={`${finding.code}-${finding.path}-${index}`}
          icon={finding.severity === 'info' ? <Info /> : <CircleAlert />}
          title={sentence(finding)}
          wrap
          stack
          subtitle={finding.path || undefined}
          meta={<Pill tone={TONE[finding.severity]}>{t(`severity.${finding.severity}`)}</Pill>}
        />
      ))}
    </List>
  );
}

// Notice and list together, for the Prüfung view and the adoption step.
export function FindingsBlock({
  findings,
  license,
  kind,
}: {
  findings: CatalogFinding[];
  license: string | null;
  kind: CatalogSourceKind;
}) {
  return (
    <Stack gap={4}>
      <VerdictNotice findings={findings} />
      <FindingList findings={findings} license={license} kind={kind} />
    </Stack>
  );
}
