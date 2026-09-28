import Link from 'next/link';
import { useState } from 'react';
import { FlaskConical, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrowserControlMode, BrowserControlPolicy } from '@/lib/api/endpoints/browserTask';
import { accessPath } from '@/utils/paths';
import {
  useBrowserControlQuery,
  useProjectConnectionsQuery,
  useUpdateBrowserControl,
} from '../services/browserTask.service';
import { confidenceOf, connectionLabel } from '../utils/lab';
import { browserLabPath } from '../utils/paths';

const MODES: BrowserControlMode[] = ['inherit', 'standard', 'decision'];
const POLICIES: BrowserControlPolicy[] = ['auto', 'jev'];

// Projekt → Einstellungen → Browser, "Browser-Steuerung" (docs/helena-decisions/browser-task.md
// §3.3): whether the project's agents drive the browser step by step with their own model
// (Standard, as before) or hand multi-step work to a decision model (browser_task), which one, and
// with which policy. Every control saves on its own.
export function BrowserControlSection({
  projectKey,
  editable,
}: {
  projectKey: string;
  editable: boolean;
}) {
  const t = useTranslations('browserLab.control');
  const control = useBrowserControlQuery(projectKey);
  const connections = useProjectConnectionsQuery(projectKey).data?.connections ?? [];
  const update = useUpdateBrowserControl(projectKey);
  const [threshold, setThreshold] = useState<string | null>(null);

  if (control.isPending || !control.data) return <ListSkeleton rows={2} rowClassName="h-12" />;
  const { setting, effective } = control.data;
  const shownThreshold =
    threshold ?? (setting.minConfidence === null ? '' : String(setting.minConfidence));

  return (
    <SettingsSection title={t('title')} description={t('hint')}>
      <SettingsCard className="divide-y divide-border/60">
        <SettingsRow
          title={t('mode')}
          description={
            effective.enabled
              ? t('activeDecision', {
                  label: effective.label,
                  source: t(`source.${effective.source}`),
                })
              : t('activeStandard', { source: t(`source.${effective.source}`) })
          }
          control={
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                {setting.mode !== 'inherit' && (
                  <span
                    className="size-1.5 rounded-full bg-brand"
                    title="Home-Vorgabe überschrieben"
                  />
                )}
                <Select
                  value={setting.mode}
                  disabled={!editable}
                  onValueChange={(mode) => {
                    const next = mode as BrowserControlMode;
                    if (next === 'decision' && connections.length === 0) return;
                    update.mutate({
                      mode: next,
                      ...(next === 'decision' && setting.credentialId === null
                        ? { credentialId: connections[0]!.id }
                        : {}),
                    });
                  }}
                >
                  <SelectTrigger className="w-64" aria-label={t('mode')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((mode) => (
                      <SelectItem
                        key={mode}
                        value={mode}
                        disabled={mode === 'decision' && connections.length === 0}
                      >
                        {t(`modes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {setting.mode !== 'inherit' && editable && (
                <button
                  type="button"
                  className="text-xs text-brand hover:underline"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ mode: 'inherit' })}
                >
                  {'Auf Home-Vorgabe zurücksetzen'}
                </button>
              )}
            </div>
          }
        />
        {effective.problem === 'connection_missing' && (
          <p className="px-4 py-3 text-sm text-destructive">{t('connectionMissing')}</p>
        )}
        {connections.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">{t('noConnection')}</p>
            <Button asChild variant="outline" size="sm">
              <Link href={accessPath('credentials')}>
                <KeyRound />
                {t('toAccess')}
              </Link>
            </Button>
          </div>
        )}
        {setting.mode === 'decision' && (
          <>
            <SettingsRow
              title={t('connection')}
              description={t('connectionHint')}
              control={
                <Select
                  value={setting.credentialId === null ? undefined : String(setting.credentialId)}
                  disabled={!editable}
                  onValueChange={(id) => update.mutate({ credentialId: Number(id) })}
                >
                  <SelectTrigger className="w-60" aria-label={t('connection')}>
                    <SelectValue placeholder={t('chooseConnection')} />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((connection) => (
                      <SelectItem key={connection.id} value={String(connection.id)}>
                        {connectionLabel(connection)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <SettingsRow
              title={t('policy')}
              description={t('policyHint')}
              control={
                <Select
                  value={setting.policy}
                  disabled={!editable}
                  onValueChange={(policy) =>
                    update.mutate({ policy: policy as BrowserControlPolicy })
                  }
                >
                  <SelectTrigger className="w-60" aria-label={t('policy')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICIES.map((policy) => (
                      <SelectItem key={policy} value={policy}>
                        {t(`policies.${policy}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <SettingsRow
              title={t('threshold')}
              description={t('thresholdHint')}
              control={
                <Input
                  className="h-8 w-24"
                  inputMode="decimal"
                  placeholder={t('thresholdDefault')}
                  value={shownThreshold}
                  disabled={!editable}
                  aria-label={t('threshold')}
                  onChange={(e) => setThreshold(e.target.value)}
                  onBlur={() => {
                    const value = confidenceOf(shownThreshold);
                    if (value !== undefined && value !== setting.minConfidence) {
                      update.mutate({ minConfidence: value });
                    }
                    setThreshold(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              }
            />
          </>
        )}
        <div className="flex justify-end px-4 py-3">
          <Button asChild variant="outline" size="sm">
            <Link href={browserLabPath(projectKey)}>
              <FlaskConical />
              {t('toLab')}
            </Link>
          </Button>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
