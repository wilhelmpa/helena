import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MAX_AGENT_NETWORK_DOMAINS } from '@/lib/api/endpoints/agentNetwork';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import type { AgentNetworkForm as Form } from '../../hooks/useAgentNetworkForm';
import AgentNetworkModePicker from './AgentNetworkModePicker';
import SettingsNetworkAgentOverrides from './SettingsNetworkAgentOverrides';

import { Stack, Text, Inline } from '@/design-system';

// The mode, the allow/deny lists, the mail-port switch and the per-agent overrides.
// The Save action lives in the page header; this only holds the fields and the
// save error, if any.
export default function SettingsNetworkForm({ form }: { form: Form }) {
  const t = useTranslations('settings.network');
  const disabled = !form.editable || form.saving;
  const allowActive = form.allowListActive;

  return (
    <Stack gap={5}>
      <Alert className="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300">
        <Info />
        <AlertDescription className="text-xs text-current">{t('isolationNote')}</AlertDescription>
      </Alert>

      <SettingsSection title={t('accessTitle')} description={t('accessHint')}>
        <SettingsCard className="divide-y divide-border/60">
          <AgentNetworkModePicker value={form.mode} onChange={form.setMode} disabled={disabled} />
        </SettingsCard>

        <SettingsCard>
          <Stack gap={4} pad={4}>
            <DomainField
              id="agent-network-allow"
              label={t('allowLabel')}
              value={form.allowText}
              onChange={form.setAllowText}
              count={form.allowCount}
              disabled={disabled || !allowActive}
              emphasized={allowActive}
              hint={!allowActive ? t('allowOnlyHint') : undefined}
            />
            <DomainField
              id="agent-network-deny"
              label={t('denyLabel')}
              value={form.denyText}
              onChange={form.setDenyText}
              count={form.denyCount}
              disabled={disabled}
            />
            <Text as="p" size="xs" tone="muted">
              {t('domainsPerLine')}
            </Text>
          </Stack>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mailTitle')}>
        <SettingsCard className="divide-y divide-border/60">
          <SettingsRow
            title={t('mailPortsLabel')}
            description={t('mailPortsHint')}
            control={
              <Switch
                checked={form.mailPorts}
                disabled={disabled}
                onCheckedChange={form.setMailPorts}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsNetworkAgentOverrides form={form} />

      {form.errorMessage && (
        <Text as="p" size="sm" tone="danger">
          {form.errorMessage}
        </Text>
      )}
    </Stack>
  );
}

function DomainField({
  id,
  label,
  value,
  onChange,
  count,
  disabled,
  emphasized,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  count: number;
  disabled: boolean;
  emphasized?: boolean;
  hint?: string;
}) {
  const t = useTranslations('settings.network');
  const overLimit = count > MAX_AGENT_NETWORK_DOMAINS;

  return (
    <Stack gap={2}>
      <Inline gap={4} justify="between" className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            overLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t('domainCount', { count, max: MAX_AGENT_NETWORK_DOMAINS })}
        </span>
      </Inline>
      <Textarea
        id={id}
        rows={5}
        placeholder="example.com"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          'font-mono text-xs',
          emphasized && 'border-primary/60 ring-1 ring-primary/20',
        )}
      />
      {hint && (
        <Text as="p" size="xs" tone="muted">
          {hint}
        </Text>
      )}
    </Stack>
  );
}
