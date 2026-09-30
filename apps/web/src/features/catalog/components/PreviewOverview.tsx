'use client';

import { Play, Search } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  CodeBlock,
  CopyValue,
  DetailGroup,
  Inline,
  Notice,
  Pill,
  Property,
  PropertyGrid,
  Stack,
  Text,
} from '@/design-system';
import Markdown from '@/components/common/Markdown';
import type { CatalogPreview } from '@/lib/api/endpoints/catalog';
import {
  formatBytes,
  installedRevision,
  isSkillKind,
  shortHash,
  shortPin,
  sourceLabel,
  withoutFrontMatter,
} from '../utils/catalog';
import { FindingsBlock } from './FindingsView';
import ScopeLabel from './ScopeLabel';

const KNOWN_PERMISSIONS = new Set([
  'isolated agent sandbox',
  'configured egress',
  'network access through agent egress',
  'project filesystem access',
  'subprocess execution',
]);

// The first view of an entry: what it is, where it comes from, what the inspection found,
// and for a skill its text as it will read to the agent.
export default function PreviewOverview({
  teamId,
  preview,
  busy,
  onInspect,
}: {
  teamId: number;
  preview: CatalogPreview;
  busy: boolean;
  onInspect: () => void;
}) {
  const t = useTranslations('catalog.preview');
  const format = useFormatter();
  const { item, source, latest, install } = preview;
  const skill = isSkillKind(source.kind);
  const installed = installedRevision(preview);
  const manifest = latest?.manifest;

  return (
    <Stack gap={5}>
      {item.description && <Text tone="muted">{item.description}</Text>}
      {!latest ? (
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
      ) : (
        <FindingsBlock findings={latest.findings} license={latest.license} kind={source.kind} />
      )}

      <DetailGroup title={t('properties')}>
        <PropertyGrid columns={1}>
          <Property label={t('kind')}>{skill ? t('kindSkill') : t('kindMcp')}</Property>
          <Property label={t('origin')}>
            <Inline gap={2} wrap>
              <Text mono>{sourceLabel(source.locator)}</Text>
              {source.role && <Pill>{source.role}</Pill>}
              {!source.enabled && <Pill tone="warning">{t('sourceOff')}</Pill>}
            </Inline>
          </Property>
          {latest && (
            <>
              <Property label={t('version')}>
                <CopyValue
                  value={latest.pin}
                  display={shortPin(latest.pin)}
                  label={t('versionLabel')}
                />
              </Property>
              <Property label={t('license')}>{latest.license ?? t('licenseUnknown')}</Property>
              <Property label={t('size')}>{formatBytes(latest.size)}</Property>
              <Property label={t('checksum')}>
                <CopyValue
                  value={latest.sha256}
                  display={shortHash(latest.sha256)}
                  label={t('checksumLabel')}
                />
              </Property>
              <Property label={t('inspectedAt')}>
                {format.dateTime(new Date(latest.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </Property>
            </>
          )}
          <Property label={t('installed')}>
            {install ? (
              <Stack gap={1}>
                <Inline gap={2} wrap>
                  <Pill tone="success">{t('installedYes')}</Pill>
                  {installed && (
                    <Text size="sm">{t('pinnedTo', { pin: shortPin(installed.pin) })}</Text>
                  )}
                </Inline>
                <Text size="xs" tone="muted">
                  <ScopeLabel teamId={teamId} scope={install.scope} />
                </Text>
              </Stack>
            ) : (
              t('installedNo')
            )}
          </Property>
        </PropertyGrid>
      </DetailGroup>

      {!skill && manifest && (
        <DetailGroup title={t('mcp.title')}>
          <Stack gap={3}>
            {manifest.command && (
              <Stack gap={1}>
                <Text size="xs" tone="muted">
                  {t('mcp.command')}
                </Text>
                <CodeBlock>{[manifest.command, ...(manifest.args ?? [])].join(' ')}</CodeBlock>
              </Stack>
            )}
            {manifest.environment.length > 0 && (
              <Stack gap={1}>
                <Text size="xs" tone="muted">
                  {t('mcp.environment')}
                </Text>
                <Inline gap={2} wrap>
                  {manifest.environment.map((name) => (
                    <Pill key={name}>{name}</Pill>
                  ))}
                </Inline>
              </Stack>
            )}
            {manifest.permissions.length > 0 && (
              <Stack gap={1}>
                <Text size="xs" tone="muted">
                  {t('mcp.permissions')}
                </Text>
                {manifest.permissions.map((permission) => (
                  <Text key={permission} size="sm">
                    {KNOWN_PERMISSIONS.has(permission)
                      ? t(`mcp.permission.${permission}` as never)
                      : permission}
                  </Text>
                ))}
              </Stack>
            )}
          </Stack>
        </DetailGroup>
      )}

      {skill && manifest?.markdown && (
        <DetailGroup title={t('skillText')}>
          <div className="ds-skill-text">
            <Markdown>{withoutFrontMatter(manifest.markdown)}</Markdown>
          </div>
        </DetailGroup>
      )}
    </Stack>
  );
}
