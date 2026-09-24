'use client';

import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import { byKey } from '@/utils/messageKey';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import EnabledSwitch from '@/components/common/inputs/EnabledSwitch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PluginView } from '@/lib/api/endpoints/plugins';
import { usePluginDecision, usePluginsQuery } from '@/services/plugins.service';
import GodSectionPage from './components/GodSectionPage';

// Administrator → Plugins (docs/helena-framework.md): Helena's own plugins, and the
// external ones found in the plugin folder with what they provide and the rights they
// ask for. External plugins run inside Helena with its rights, so they load only when
// switched on as a whole and approved one by one at their exact version and files.
// Decisions apply when the API and the worker next start.
export default function GodPluginsPage() {
  const t = useTranslations('god.plugins');
  const overview = usePluginsQuery();
  const decide = usePluginDecision();
  const data = overview.data;
  const builtin = data?.plugins.filter((plugin) => plugin.source === 'builtin') ?? [];
  const external = data?.plugins.filter((plugin) => plugin.source === 'external') ?? [];
  const busy = decide.setExternal.isPending || decide.approve.isPending || decide.revoke.isPending;

  return (
    <GodSectionPage slug="plugins">
      <SettingsSection
        title={t('externalTitle')}
        description={t('externalDescription')}
        action={
          <EnabledSwitch
            checked={data?.externalEnabled ?? false}
            onChange={(checked) => decide.setExternal.mutate(checked)}
            disabled={!data || busy}
          />
        }
      >
        <SettingsCard className="space-y-1 p-4">
          <p className="text-muted-foreground">
            {data?.pluginsDir ? t('folder', { path: data.pluginsDir }) : t('noFolder')}
          </p>
          <p className="text-muted-foreground">{t('restartHint')}</p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('foundTitle')}>
        {external.length === 0 ? (
          <SettingsCard className="p-4 text-muted-foreground">{t('none')}</SettingsCard>
        ) : (
          external.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              actions={
                plugin.approved ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => decide.revoke.mutate(plugin.id)}
                  >
                    {t('revoke')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
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
      </SettingsSection>

      <SettingsSection title={t('builtinTitle')}>
        {builtin.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </SettingsSection>
    </GodSectionPage>
  );
}

const PROBLEMS = ['external-off', 'not-approved', 'version-changed', 'files-changed'];

function PluginCard({ plugin, actions }: { plugin: PluginView; actions?: React.ReactNode }) {
  const t = useTranslations('god.plugins');
  const tAny = byKey(useTranslations());
  const locale = useLocale();
  const text = (value: PluginView['name']) => resolveText(value, locale, (key) => tAny(key));
  const problem =
    plugin.problem && PROBLEMS.includes(plugin.problem)
      ? tAny(`god.plugins.problems.${plugin.problem}`)
      : plugin.problem;
  const provides = Object.entries(plugin.provides).filter(([, ids]) => ids.length > 0);
  const status =
    plugin.status === 'loaded'
      ? t('statusLoaded')
      : plugin.status === 'failed'
        ? t('statusFailed')
        : t('statusNotLoaded');
  return (
    <SettingsCard className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{text(plugin.name)}</span>
        <span className="text-muted-foreground">{plugin.version}</span>
        <Badge variant={plugin.status === 'loaded' ? 'secondary' : 'outline'}>{status}</Badge>
        {plugin.restartRequired ? <Badge variant="outline">{t('restartRequired')}</Badge> : null}
        <span className="ms-auto">{actions}</span>
      </div>
      {plugin.description ? (
        <p className="text-muted-foreground">{text(plugin.description)}</p>
      ) : null}
      {plugin.error ? <p className="text-xs text-destructive">{plugin.error}</p> : null}
      {problem ? <p className="text-xs text-muted-foreground">{problem}</p> : null}
      {provides.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('provides')}:{' '}
          {provides.map(([kind, ids]) => `${kind} (${ids.join(', ')})`).join(' · ')}
        </p>
      ) : null}
      {plugin.source === 'external' ? (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            {t('actions')}: {plugin.permissions.actions.join(', ') || '–'}
          </p>
          <p>
            {t('events')}: {plugin.permissions.events.join(', ') || '–'}
          </p>
          <p>
            {t('network')}: {plugin.permissions.network.join(', ') || '–'}
          </p>
          {plugin.permissions.credentials ? <p>{t('credentials')}</p> : null}
          {plugin.digest ? <p className="truncate font-mono">{plugin.digest}</p> : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
