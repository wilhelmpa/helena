'use client';

import { useState } from 'react';
import { ArrowRight, GitCompare, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  CodeBlock,
  DetailGroup,
  EmptyState,
  Inline,
  List,
  ListRow,
  Notice,
  PillButton,
  Pill,
  PopoverPick,
  Stack,
  Text,
  TextDiff,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { CatalogFinding, CatalogPreview } from '@/lib/api/endpoints/catalog';
import { useCatalogDiffQuery } from '@/services/catalog.service';
import { decodeContent, isSkillKind, shortPin } from '../utils/catalog';
import { FindingList } from './FindingsView';

const sameFinding = (a: CatalogFinding, b: CatalogFinding) =>
  a.code === b.code && a.path === b.path;

// The versions of an entry that were inspected, and what changed between two of them: the
// text of the skill, every file that differs and which findings are new or gone. A newer
// version of an installed entry waits here for the owner to update to it.
export default function PreviewVersions({
  teamId,
  preview,
  busy,
  onInspect,
  onUpdate,
}: {
  teamId: number;
  preview: CatalogPreview;
  busy: boolean;
  onInspect: () => void;
  onUpdate: () => void;
}) {
  const t = useTranslations('catalog.versions');
  const format = useFormatter();
  const { item, install, revisions, source } = preview;
  const latestId = item.latestRevisionId;
  const installedId = install?.revisionId ?? null;
  const newer = installedId != null && latestId != null && installedId !== latestId;
  const older = revisions.filter((revision) => revision.id !== latestId);
  const defaultFrom =
    (installedId !== latestId
      ? installedId
      : (install?.previousRevisionId ?? older[0]?.id ?? null)) ?? null;
  const [fromState, setFromState] = useState<number | null>(null);
  const [toState, setToState] = useState<number | null>(null);
  const from = fromState ?? defaultFrom;
  const to = toState ?? latestId;
  const diff = useCatalogDiffQuery(teamId, item.id, from, to);
  const pinOf = (id: number | null) => {
    const found = revisions.find((revision) => revision.id === id);
    return found ? shortPin(found.pin) : '…';
  };
  const pickItems = (current: number | null, set: (id: number) => void) =>
    revisions.map((revision) => ({
      key: String(revision.id),
      search: revision.pin,
      icon: <GitCompare />,
      label: shortPin(revision.pin),
      selected: revision.id === current,
      trailing:
        revision.id === installedId ? <Pill tone="success">{t('installedTag')}</Pill> : undefined,
      onSelect: () => set(revision.id),
    }));
  const skill = isSkillKind(source.kind);

  return (
    <Stack gap={5}>
      {newer && (
        <Notice
          icon={<RefreshCw />}
          title={t('newer.title', { pin: pinOf(latestId) })}
          action={
            <Button variant="primary" onClick={onUpdate}>
              {t('newer.action')}
            </Button>
          }
        >
          {t('newer.text')}
        </Notice>
      )}
      <Inline gap={2} wrap justify="between">
        <Text size="xs" tone="muted">
          {t('count', { count: revisions.length })}
        </Text>
        <Button icon={<RefreshCw />} size="small" disabled={busy} onClick={onInspect}>
          {busy ? t('checking') : t('checkNew')}
        </Button>
      </Inline>
      <List label={t('title')}>
        {revisions.map((revision) => (
          <ListRow
            key={revision.id}
            title={shortPin(revision.pin)}
            subtitle={format.dateTime(new Date(revision.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            meta={
              <>
                {revision.id === installedId && <Pill tone="success">{t('installedTag')}</Pill>}
                {revision.id === install?.previousRevisionId && <Pill>{t('previousTag')}</Pill>}
                {revision.id === latestId && <Pill tone="accent">{t('latestTag')}</Pill>}
              </>
            }
          />
        ))}
      </List>

      {revisions.length < 2 ? (
        <EmptyState fill={false} icon={<GitCompare />}>
          {t('onlyOne')}
        </EmptyState>
      ) : (
        <DetailGroup title={t('changes')}>
          <Stack gap={3}>
            <Inline gap={2} wrap>
              <PopoverPick
                inputPlaceholder={t('searchVersion')}
                items={pickItems(from, setFromState)}
                trigger={<PillButton tone="active">{t('from', { pin: pinOf(from) })}</PillButton>}
              />
              <ArrowRight size={14} aria-hidden="true" />
              <PopoverPick
                inputPlaceholder={t('searchVersion')}
                items={pickItems(to, setToState)}
                trigger={<PillButton tone="active">{t('to', { pin: pinOf(to) })}</PillButton>}
              />
            </Inline>
            {from == null || to == null || from === to ? (
              <Text size="sm" tone="muted">
                {t('pickTwo')}
              </Text>
            ) : diff.isPending ? (
              <ListSkeleton rows={3} rowClassName="h-5" />
            ) : diff.isError || !diff.data ? (
              <Notice tone="danger" title={t('diffFailed')} />
            ) : (
              <Stack gap={4}>
                <Inline gap={2} wrap>
                  <Pill tone="success">{t('added', { count: diff.data.added.length })}</Pill>
                  <Pill tone="danger">{t('removed', { count: diff.data.removed.length })}</Pill>
                  <Pill>{t('changed', { count: diff.data.changed.length })}</Pill>
                </Inline>
                {(() => {
                  const fresh = diff.data.findingsAfter.filter(
                    (finding) => !diff.data.findingsBefore.some((old) => sameFinding(old, finding)),
                  );
                  const gone = diff.data.findingsBefore.filter(
                    (finding) => !diff.data.findingsAfter.some((now) => sameFinding(now, finding)),
                  );
                  return (
                    <>
                      {fresh.length > 0 && (
                        <Stack gap={2}>
                          <Text size="sm" weight="medium">
                            {t('newFindings')}
                          </Text>
                          <FindingList
                            findings={fresh}
                            license={preview.latest?.license ?? null}
                            kind={source.kind}
                          />
                        </Stack>
                      )}
                      {gone.length > 0 && (
                        <Text size="xs" tone="muted">
                          {t('goneFindings', { count: gone.length })}
                        </Text>
                      )}
                    </>
                  );
                })()}
                {skill && diff.data.markdownBefore !== diff.data.markdownAfter && (
                  <Stack gap={1}>
                    <Text size="xs" tone="muted" mono>
                      {'SKILL.md'}
                    </Text>
                    <TextDiff before={diff.data.markdownBefore} after={diff.data.markdownAfter} />
                  </Stack>
                )}
                {diff.data.files
                  .filter((file) => !(skill && file.path === 'SKILL.md'))
                  .map((file) => {
                    const before = decodeContent(file.before);
                    const after = decodeContent(file.after);
                    const hidden =
                      (file.before && file.before.content === '') ||
                      (file.after && file.after.content === '');
                    return (
                      <Stack key={file.path} gap={1}>
                        <Inline gap={2}>
                          <Text size="xs" tone="muted" mono>
                            {file.path}
                          </Text>
                          <Pill
                            tone={!file.before ? 'success' : !file.after ? 'danger' : 'neutral'}
                          >
                            {!file.before
                              ? t('fileNew')
                              : !file.after
                                ? t('fileGone')
                                : t('fileChanged')}
                          </Pill>
                        </Inline>
                        {hidden ? (
                          <CodeBlock>{t('fileHidden')}</CodeBlock>
                        ) : (
                          <TextDiff before={before ?? ''} after={after ?? ''} />
                        )}
                      </Stack>
                    );
                  })}
                {diff.data.added.length + diff.data.removed.length + diff.data.changed.length ===
                  0 &&
                  diff.data.markdownBefore === diff.data.markdownAfter && (
                    <Text size="sm" tone="muted">
                      {t('noChanges')}
                    </Text>
                  )}
              </Stack>
            )}
          </Stack>
        </DetailGroup>
      )}
    </Stack>
  );
}
