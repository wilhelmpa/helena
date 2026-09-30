'use client';

import { useTranslations } from 'next-intl';
import { Button, SettingsGroup, SettingsRow, Stack, Switch, Text } from '@/design-system';
import { useRootAccess } from '../../services/root-access.service';

export default function GodRootAccess() {
  const t = useTranslations('god.security.rootAccess');
  const { settings, audit, update } = useRootAccess();
  return (
    <SettingsGroup title={t('title')} description={t('boundary')}>
      {(['enabled', 'directOnly', 'unrestricted'] as const).map((key) => (
        <SettingsRow key={key} label={t(key)} htmlFor={`root-${key}`}>
          <Switch
            id={`root-${key}`}
            checked={settings.data?.[key] ?? true}
            disabled={!settings.data || update.isPending}
            onCheckedChange={(checked) =>
              settings.data && update.mutate({ ...settings.data, [key]: checked })
            }
          />
        </SettingsRow>
      ))}
      {(settings.error || audit.error || update.error) && (
        <Text>{String(settings.error || audit.error || update.error)}</Text>
      )}
      <SettingsRow label={t('audit')} stacked>
        <Stack>
          <Button onClick={() => void audit.refetch()}>{t('refresh')}</Button>
          {audit.data?.map((entry) => (
            <Stack key={entry.id}>
              <Text>
                {entry.startedAt ?? entry.createdAt} – {entry.finishedAt ?? '—'} · {entry.status} ·{' '}
                {entry.origin} · {entry.runtime}
              </Text>
              <Text>{entry.command}</Text>
              <Text>{entry.reason}</Text>
              <Text>
                {entry.taintSources.join(', ')} {entry.persistence.join(', ')}
              </Text>
              <Text>{`Agent ${entry.agentId} · Run ${entry.runId ?? '—'} · Chat ${entry.messageId ?? '—'} · Exit ${entry.exitCode ?? '—'}`}</Text>
              {entry.output && <Text>{entry.output}</Text>}
            </Stack>
          ))}
        </Stack>
      </SettingsRow>
    </SettingsGroup>
  );
}
