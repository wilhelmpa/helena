'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { byKey } from '@/utils/messageKey';
import { Switch } from '@/components/ui/switch';
import { Button, EmptyState, Pill, SettingsGroup, SettingsRow } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { PluginView } from '@/lib/api/endpoints/plugins';
import {
  usePluginDecision,
  usePluginProjectsQuery,
  usePluginsQuery,
} from '@/services/plugins.service';
import { settingsPath } from '@/utils/paths';
import GodSectionPage from './components/GodSectionPage';

// Helena › Einstellungen › Erweiterungen (docs/helena-framework.md): every installed
// extension with its version, its status and what it provides, and the projects it has
// settings in (each a link to that project's Einstellungen › Erweiterungen). Below, the
// external ones from the plugin folder: they run inside Helena with its rights, so they load
// only when switched on as a whole and approved one by one at their exact version and files.
// Decisions apply when the API and the worker next start.
export default function GodPluginsPage() {
  const t = useTranslations('god.plugins');
  const overview = usePluginsQuery();
  const projects = usePluginProjectsQuery();
  const decide = usePluginDecision();
  const data = overview.data;
  const busy = decide.setExternal.isPending || decide.approve.isPending || decide.revoke.isPending;

  if (overview.isPending)
    return (
      <GodSectionPage slug="plugins">
        <ListSkeleton rows={6} rowClassName="h-14" />
      </GodSectionPage>
    );
  if (!data)
    return (
      <GodSectionPage slug="plugins">
        <EmptyState>{t('loadFailed')}</EmptyState>
      </GodSectionPage>
    );

  const installed = data.plugins.filter(
    (plugin) => plugin.source === 'builtin' || plugin.status === 'loaded',
  );
  const found = data.plugins.filter((plugin) => plugin.source === 'external');

  return (
    <GodSectionPage slug="plugins">
      <SettingsGroup title={t('installedTitle')} description={t('installedDescription')}>
        {installed.map((plugin) => (
          <PluginRow key={plugin.id} plugin={plugin} projects={projects.data?.[plugin.id]} />
        ))}
      </SettingsGroup>

      <SettingsGroup title={t('externalTitle')} description={t('externalDescription')}>
        <SettingsRow
          label={t('externalSwitch')}
          description={data.pluginsDir ? t('folder', { path: data.pluginsDir }) : t('noFolder')}
          htmlFor="plugins-external"
        >
          <Switch
            id="plugins-external"
            checked={data.externalEnabled}
            onCheckedChange={(checked) => decide.setExternal.mutate(checked)}
            disabled={busy}
          />
        </SettingsRow>
        {found.length === 0 ? (
          <SettingsRow label={t('foundTitle')} description={t('none')} />
        ) : (
          found.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              projects={projects.data?.[plugin.id]}
              action={
                plugin.approved ? (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => decide.revoke.mutate(plugin.id)}
                  >
                    {t('revoke')}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="primary"
                    disabled={busy || plugin.status === 'failed'}
                    onClick={() => decide.approve.mutate(plugin.id)}
                  >
                    {t('approve')}
                  </Button>
                )
              }
            />
          ))
        )}
        <SettingsRow label={t('restartTitle')} description={t('restartHint')} />
      </SettingsGroup>
    </GodSectionPage>
  );
}

const PROBLEMS = ['external-off', 'not-approved', 'version-changed', 'files-changed'];
const KINDS = new Set([
  'runtimes',
  'connectors',
  'tools',
  'stepTypes',
  'triggerTypes',
  'policies',
  'uiSlots',
  'knowledgeSources',
  'captureTargets',
  'bundles',
  'hostCapabilities',
  'profileContributions',
  'usageLimitSources',
  'runtimeLoginSources',
  'modelServers',
  'localAiTaskClasses',
  'updateSources',
  'decisionBackends',
  'decisionClasses',
  'notificationCategories',
  'alertSources',
  'events',
  'mcpServers',
]);

function PluginRow({
  plugin,
  projects,
  action,
}: {
  plugin: PluginView;
  projects?: { key: string; name: string }[];
  action?: React.ReactNode;
}) {
  const t = useTranslations('god.plugins');
  const tAny = byKey(useTranslations());
  const locale = useLocale();
  const text = (value: PluginView['name']) => resolveText(value, locale, (key) => tAny(key));
  const problem =
    plugin.problem && PROBLEMS.includes(plugin.problem)
      ? tAny(`god.plugins.problems.${plugin.problem}`)
      : plugin.problem;
  const provides = Object.entries(plugin.provides)
    .filter(([, ids]) => ids.length > 0)
    .map(([kind]) => (KINDS.has(kind) ? tAny(`god.plugins.kinds.${kind}`) : kind));
  const status =
    plugin.status === 'loaded'
      ? { tone: 'success' as const, label: t('statusLoaded') }
      : plugin.status === 'failed'
        ? { tone: 'danger' as const, label: t('statusFailed') }
        : { tone: 'neutral' as const, label: t('statusNotLoaded') };
  const permissions =
    plugin.source === 'external'
      ? [
          `${t('actions')}: ${plugin.permissions.actions.join(', ') || '–'}`,
          `${t('network')}: ${plugin.permissions.network.join(', ') || '–'}`,
        ].join(' · ')
      : null;

  return (
    <SettingsRow
      label={
        <span className="ds-plugin-name">
          {text(plugin.name)}
          <span className="ds-plugin-version">{plugin.version}</span>
        </span>
      }
      description={
        <span className="ds-plugin-meta">
          {plugin.description && <span>{text(plugin.description)}</span>}
          {provides.length > 0 && (
            <span>
              {t('provides')}: {provides.join(', ')}
            </span>
          )}
          {projects && projects.length > 0 && (
            <span>
              {t('inProjects')}:{' '}
              {projects.map((project, index) => (
                <span key={project.key}>
                  {index > 0 && ', '}
                  <Link className="ds-link" href={settingsPath(project.key, 'extensions')}>
                    {project.name}
                  </Link>
                </span>
              ))}
            </span>
          )}
          {permissions && <span>{permissions}</span>}
          {plugin.error && <span className="ds-field-error">{plugin.error}</span>}
          {problem && <span>{problem}</span>}
        </span>
      }
    >
      {plugin.restartRequired && <Pill tone="warning">{t('restartRequired')}</Pill>}
      <Pill tone={status.tone}>{status.label}</Pill>
      {action}
    </SettingsRow>
  );
}
