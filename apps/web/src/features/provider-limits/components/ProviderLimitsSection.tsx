'use client';

import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { LimitAccount, LimitSettings } from '@/lib/api/endpoints/providerLimits';
import { compactTokens } from '@/utils/agentUsage';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import { useAccountName } from '../hooks/useAccountName';
import { useNow } from '../hooks/useNow';
import {
  useForgetLimitAccount,
  useProviderLimits,
  useRefreshProviderLimits,
  useSetLimitSettings,
} from '../services/providerLimits.service';
import { STATE_STATUS, orderedAccounts, orderedWindows } from '../utils/limitsFormat';
import LimitWindowRow from './LimitWindowRow';
import { NameList, Sections } from '@/design-system';

const INTERVALS = [5, 10, 15, 30, 60];
const THRESHOLDS = [70, 80, 90, 95];

// Administrator → Agenten-Laufzeit → Limits: how often Helena reads the plan limits and from
// which share a window counts as close, and per account every window with its reset time,
// the agents working on it and what they spent in the window, where the numbers came from.
export default function ProviderLimitsSection() {
  const t = useTranslations('providerLimits');
  const limits = useProviderLimits(true);
  const refresh = useRefreshProviderLimits();
  const now = useNow();

  return (
    <Sections id="limits" className="scroll-mt-4">
      <SettingsSection
        title={t('title')}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {t('refresh')}
          </Button>
        }
      >
        {limits.data ? (
          <LimitSettingsCard settings={limits.data.settings} probedAt={limits.data.probedAt} />
        ) : (
          <ListSkeleton rows={2} rowClassName="h-12" />
        )}
      </SettingsSection>
      {limits.data && now !== null && (
        <SettingsSection title={t('accountsTitle')}>
          <div className="space-y-4">
            {limits.data.accounts.length === 0 ? (
              <SettingsCard className="p-4 text-sm text-muted-foreground">
                {t('empty')}
              </SettingsCard>
            ) : (
              orderedAccounts(limits.data.accounts).map((account) => (
                <AccountDetails key={account.id} account={account} now={now} />
              ))
            )}
          </div>
        </SettingsSection>
      )}
    </Sections>
  );
}

function LimitSettingsCard({
  settings,
  probedAt,
}: {
  settings: LimitSettings;
  probedAt: string | null;
}) {
  const t = useTranslations('providerLimits.settings');
  const save = useSetLimitSettings();
  return (
    <SettingsCard className="divide-y">
      <SettingsRow
        title={t('auto')}
        description={
          probedAt ? t('autoHintAt', { time: formatDurationShort(probedAt) }) : t('autoHint')
        }
        control={
          <Switch
            checked={settings.enabled}
            disabled={save.isPending}
            aria-label={t('auto')}
            onCheckedChange={(enabled) => save.mutate({ enabled })}
          />
        }
      />
      <SettingsRow
        title={t('interval')}
        description={t('intervalHint')}
        control={
          <Select
            value={String(settings.intervalMinutes)}
            disabled={save.isPending}
            onValueChange={(value) => save.mutate({ intervalMinutes: Number(value) })}
          >
            <SelectTrigger className="w-32" aria-label={t('interval')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {t('minutes', { count: minutes })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        title={t('near')}
        description={t('nearHint')}
        control={
          <Select
            value={String(settings.nearPercent)}
            disabled={save.isPending}
            onValueChange={(value) => save.mutate({ nearPercent: Number(value) })}
          >
            <SelectTrigger className="w-32" aria-label={t('near')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...THRESHOLDS, settings.nearPercent])]
                .sort((a, b) => a - b)
                .map((percent) => (
                  <SelectItem key={percent} value={String(percent)}>
                    {t('percent', { value: percent })}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsCard>
  );
}

function AccountDetails({ account, now }: { account: LimitAccount; now: number }) {
  const t = useTranslations('providerLimits');
  const format = useFormatter();
  const name = useAccountName();
  const forget = useForgetLimitAccount();
  const windows = orderedWindows(account.windows);
  const plan = name.plan(account);
  const login = name.login(account);
  const extra = account.extra;
  const money = (value: number | null) =>
    value === null
      ? '–'
      : extra?.currency
        ? format.number(value, { style: 'currency', currency: extra.currency })
        : format.number(value);

  return (
    <SettingsCard>
      <div className="flex min-w-0 items-center gap-2 border-b border-sidebar-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {[name.provider(account), plan].filter(Boolean).join(' · ')}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {t(account.via === 'passive' ? 'readPassive' : 'readVia', {
              login: login ?? account.source,
              time: formatDateTime(account.observedAt),
            })}
          </p>
        </div>
        <StatusBadge status={STATE_STATUS[account.state]}>
          {t(`state.${account.state}`)}
        </StatusBadge>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('forget')}
          title={t('forget')}
          disabled={forget.isPending}
          onClick={() => forget.mutate(account.id)}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="space-y-1 p-2">
        {account.unavailable && (
          <p className="px-2 text-xs text-muted-foreground">
            {t(`unavailable.${account.unavailable}` as 'unavailable.failed')}
          </p>
        )}
        {windows.map((window) => {
          const details = [
            window.resetsAt ? t('resetsAt', { time: formatDateTime(window.resetsAt) }) : null,
            window.agentTokens !== null
              ? t('agentTokens', { tokens: compactTokens(window.agentTokens) })
              : null,
          ].filter(Boolean);
          return (
            <div key={window.id}>
              <LimitWindowRow window={window} now={now} />
              {details.length > 0 && (
                <p className="px-2 ps-28 text-xs break-words text-muted-foreground">
                  {details.join(' · ')}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="space-y-0.5 border-t border-sidebar-border px-4 py-2.5 text-xs text-muted-foreground">
        <p>
          {account.agents.length > 0 ? (
            <>
              {t('agentsOn')} <NameList names={account.agents.map((agent) => agent.name)} />
            </>
          ) : (
            t('noAgents')
          )}
        </p>
        {extra?.enabled && (
          <p>
            {extra.kind === 'credits'
              ? t('credits', { balance: money(extra.balance) })
              : t('extraUsage', { used: money(extra.used), limit: money(extra.limit) })}
          </p>
        )}
        {!!account.resetCredits && <p>{t('resetCredits', { count: account.resetCredits })}</p>}
      </div>
    </SettingsCard>
  );
}
